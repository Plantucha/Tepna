#!/usr/bin/env node
/*
 * tools/mutation-equiv-source.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * WHY A SOURCE READER DECIDES THIS AND A RUN CANNOT
 * Residue: 2026-11-01-drafted-fixtures-discriminate-nothing-on-a-single-mutant-key
 *
 * The drafting program spent two full nights writing fixtures for 24 survivor keys and kept NOTHING:
 * the per-key arithmetic read `0 of 1` for sixteen of them. That is not a criterion set too strong.
 * A mutated initializer whose every read is a truthiness test cannot be observed by ANY input, so no
 * fixture the program writes — and none a person writes — can tell the mutant from the original. The
 * row's own evidence says it: some of these "may be unkillable by construction and owe an equivalence
 * entry rather than a test". This tool decides which, by reading the source rather than running it.
 *
 * 🔴 THE ASYMMETRY IS THE WHOLE DESIGN. A false equivalence deletes a real test obligation and leaves
 * no symptom; a missed equivalence only costs a fixture nobody can write. So the two answers are NOT
 * mirror images:
 *   · `truthiness-equivalent` and `write-only` are PROOFS. They need no run and no flow analysis: if
 *     no read of the name ANYWHERE in the function can distinguish the two values, then no path can.
 *   · `observable` is a CANDIDATE, never a verdict that the mutant is killable — the distinguishing
 *     read may sit on a path the mutated value never reaches. It names the read and the published
 *     fields the name feeds, which is the field hint the drafting program was missing.
 * Everything this reader cannot place is `undecided`, and `undecided` is a refusal, not a default.
 * (Papadakis et al. 2019 on Trivial Compiler Equivalence: an equivalent mutant belongs out of the
 * denominator rather than chased — but a FALSE equivalence is worse than the survivor it removes.
 * briefs/INTERDISCIPLINARY-LITERATURE-2026-08-16-BRIEF.md § 11a.)
 *
 * The line a key records is resolved through tools/mutation-key-core.mjs — the one home for that
 * question, so this reader cannot fork the state the ledger's own reader knows.
 *
 * Read-only. It writes no ledger and closes no entry; `mutation-survivors.mjs close
 * --source-equivalent` is the one writer, and it asks this module rather than trusting an operator.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { functionSpan, recordedLineState, splitKey } from './mutation-key-core.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The closed set of answers. A class outside it is a bug, not a new case. */
export const CLASSES = ['truthiness-equivalent', 'write-only', 'observable', 'not-an-initialiser', 'undecided', 'unresolved'];

/** The two classes that are PROOFS of equivalence — the only ones a closure may rest on. */
export const PROVEN_EQUIVALENT = ['truthiness-equivalent', 'write-only'];

/* ── 1 · MASK WHAT IS NOT CODE ───────────────────────────────────────────────────────────────────
   `summarize`'s docstring names `sessions`, `span` and `prior_gap_sec` in prose, and its comments
   name every one of them. Counted as reads, those prose mentions would make every name observable
   and this tool would answer "a fixture is owed" for all 27 — the plausible answer, arrived at by
   reading English. So comments, docstrings and ordinary string literals are blanked to spaces, which
   keeps every line's length and therefore every column. An f-string's `{...}` is KEPT: it really does
   read the name, and it reads it as a value. */
export function maskPython(src) {
  const out = [];
  let triple = null;
  for (const raw of String(src).split('\n')) {
    let line = '';
    let j = 0;
    while (j < raw.length) {
      if (triple) {
        if (raw.startsWith(triple, j)) {
          line += triple;
          j += 3;
          triple = null;
        } else {
          line += ' ';
          j += 1;
        }
        continue;
      }
      const ch = raw[j];
      if (ch === '#') {
        line += ' '.repeat(raw.length - j);
        break;
      }
      if (raw.startsWith('"""', j) || raw.startsWith("'''", j)) {
        triple = raw.slice(j, j + 3);
        line += triple;
        j += 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const pre = raw.slice(Math.max(0, j - 2), j);
        const isF = /[fF][rRbB]?$/.test(pre) || /[rRbB][fF]$/.test(pre);
        let k = j + 1;
        let body = '';
        while (k < raw.length) {
          if (raw[k] === '\\') {
            body += '  ';
            k += 2;
            continue;
          }
          if (raw[k] === ch) break;
          body += raw[k];
          k += 1;
        }
        line += ch;
        line += isF ? maskOutsideBraces(body) : ' '.repeat(body.length);
        if (k < raw.length) line += ch;
        j = k + 1;
        continue;
      }
      line += ch;
      j += 1;
    }
    out.push(line);
  }
  return out;
}

/** Inside an f-string, the `{...}` runs are code and everything else is prose. */
function maskOutsideBraces(body) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '{') {
      if (body[i + 1] === '{') {
        out += '  ';
        i += 1;
        continue;
      }
      depth += 1;
      out += ' ';
      continue;
    }
    if (c === '}') {
      if (depth > 0) depth -= 1;
      out += ' ';
      continue;
    }
    out += depth > 0 ? c : ' ';
  }
  return out;
}

/* ── 2 · THE MUTATED LINE'S SHAPE ────────────────────────────────────────────────────────────────
   Only a simple assignment of a literal to ONE bare name is in scope. A call-argument mutant
   (`daemon_starts(prev, data, offset_sec=None)`) and an operator mutant (`<` → `<=`) are real
   survivors whose question is the callee's contract or a boundary, not this name's reads — they get
   `not-an-initialiser` with the shape named, never silence. */
export function parseAssignment(line) {
  const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(:[^=]+)?=(?!=)\s*(.+?)\s*$/.exec(String(line));
  if (!m) return null;
  return { indent: m[1], name: m[2], annotation: (m[3] || '').trim() || null, value: m[4] };
}

/** Blank every LHS occurrence of `name` in a plain assignment, tuple targets included, keeping the
 * line's length so columns still line up. A subscript or attribute target (`out["k"] = x`) is NOT a
 * write to the bare name and is left alone. */
export function blankTargets(line, name) {
  const whole = String(line);
  const eq = /^([^=\n]*?)=(?!=)(.*)$/.exec(whole);
  if (!eq) return whole;
  const lhs = eq[1];
  if (/[[\]().]/.test(lhs)) return whole;
  if (!/^[\s]*[A-Za-z_][A-Za-z0-9_]*(\s*:[^=]+)?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*\s*$/.test(lhs)) return whole;
  const masked = lhs.replace(new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g'), ' '.repeat(name.length));
  return masked + '=' + eq[2];
}

/** What shape a line IS, when it is not a plain assignment — so the census names it. */
export function lineShape(before, after) {
  const asgB = parseAssignment(before);
  const asgA = parseAssignment(after);
  const b = asgB ? asgB.value : String(before);
  const a = asgA ? asgA.value : String(after);
  const pair = `${b}\n${a}`;
  if (/^\s*(if|elif|while|assert)\b/.test(b)) return 'condition';
  if (/^\s*(return|yield)\b/.test(b)) return 'return-expression';
  if (/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(b)) return 'call';
  if (/\b(and|or|not)\b/.test(pair)) return 'boolean-expression';
  if (/(<=|>=|==|!=|<|>)/.test(pair)) return 'comparison';
  if (/^\s*(for|with|try|except|else|elif)\b/.test(b)) return 'statement';
  return 'expression';
}

/* ── 3 · TRUTHINESS OF A LITERAL, OR NOTHING ─────────────────────────────────────────────────────
   `null` means this reader cannot tell, and a `null` on either side is a refusal. mutmut's string
   mutation produces `"XXno capture dataXX"`, which is TRUTHY exactly like the original it replaces —
   so "both falsy" is the wrong criterion and "the same truthiness" is the right one. */
export function literalTruth(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  if (/^(None|False|0|0\.0|0j|-0|\[\]|\{\}|\(\)|set\(\)|dict\(\)|list\(\)|tuple\(\)|""|''|b""|b''|f""|f'')$/.test(v)) return false;
  if (/^True$/.test(v)) return true;
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/.test(v)) return Number(v) !== 0;
  if (/^[fbrFBR]{0,2}(".+"|'.+')$/.test(v)) return true;
  if (/^\[[^[\]]+\]$/.test(v) && !/\bfor\b/.test(v)) return true;
  if (/^\{[^{}]+\}$/.test(v) && !/\bfor\b/.test(v)) return true;
  if (/^\([^()]*,[^()]*\)$/.test(v) && !/\bfor\b/.test(v)) return true;
  return null;
}

/* ── 4 · EVERY READ, AND WHAT KIND OF READ IT IS ─────────────────────────────────────────────────
   Three contexts, and the DEFAULT IS `value`. A truthiness read is recognised positively — the token
   sits where only its truth can matter — and everything the positive rule does not recognise is a
   value read, which is the answer that refuses an equivalence. `is None` / `is not None` is called
   out separately as `identity` because it is the read that distinguishes `None` from `""` while every
   truthiness test agrees, and that pair is most of this population. */
export function bodyStart(masked, span) {
  let depth = 0;
  for (let i = span[0]; i < span[1]; i += 1) {
    const line = masked[i] || '';
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    }
    if (depth <= 0 && /:\s*$/.test(line.replace(/\s+$/, ''))) return i + 1;
  }
  return span[0] + 1;
}

export function readContexts(masked, span, name) {
  const tok = new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
  const reads = [];
  for (let i = bodyStart(masked, span); i < span[1]; i += 1) {
    const whole = masked[i];
    if (whole == null) continue;
    if (/^\s*(global|nonlocal)\s/.test(whole) && new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(whole)) {
      reads.push({ line: i, col: 0, context: 'value', text: whole.trim() });
      continue;
    }
    /* The target of an assignment to this very name is a WRITE; its right-hand side is not. A TUPLE
       target counts too — `hz, basis = _expected_hz(d, s), "expected"` writes `basis`, and reading it
       as a read made the census cite a write as its evidence that two values differ there. */
    const text = blankTargets(whole, name);
    // `matchAll` clones the regex, so one `tok` carries no lastIndex from the line before it.
    for (const m of text.matchAll(tok)) {
      reads.push({ line: i, col: m.index, context: contextOf(text.slice(0, m.index), text.slice(m.index + name.length)), text: whole.trim() });
    }
  }
  return reads;
}

export function contextOf(before, after) {
  if (/^\s*is\s+(not\s+)?None\b/.test(after)) return 'identity';
  if (/\bis\s+(not\s+)?$/.test(before)) return 'identity';
  const beforeOk = /(^|[\s([,])(if|elif|while|and|or|not)\s+$/.test(before);
  const afterOk = /^\s*(:|\)|\]|$|else\b|and\b|or\b)/.test(after);
  if (beforeOk && afterOk) return 'truthiness';
  return 'value';
}

/** The published keys a name feeds, same line only — the field hint, and nothing invented. */
export function publishedFields(raw, reads, name) {
  const out = [];
  for (const r of reads) {
    const line = raw[r.line] || '';
    const upto = line.slice(0, r.col == null ? line.length : r.col);
    const keys = [...upto.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g)].map((k) => k[1]);
    if (keys.length) out.push({ field: keys[keys.length - 1], line: r.line, name });
  }
  return out;
}

/* ── 5 · THE DECISION ────────────────────────────────────────────────────────────────────────────── */
export function classifyEntry(src, entry) {
  const key = String(entry.key || '').trimStart();
  const halves = splitKey(key);
  const fname = String(entry.function || '');
  if (!halves) return { class: 'unresolved', reason: 'the key is not a `- old | + new` pair, so it names no line' };

  const state = recordedLineState(src, fname, halves.before);
  if (state.state !== 'present') {
    return { class: 'unresolved', reason: state.reason || `the recorded line reads ${state.state}`, lineState: state.state };
  }

  const before = parseAssignment(halves.before);
  const after = parseAssignment(halves.after);
  const shape = lineShape(halves.before, halves.after);
  const lines = String(src).split('\n');
  const masked = maskPython(src);
  const span = functionSpan(lines, fname);
  if (!span) return { class: 'unresolved', reason: `no function named ${fname} in the module` };

  /* THE FIELD HINT IS OWED BY EVERY CLASS, not only by the one that can be killed. A key the
     drafting program could make no fixture for is still worth a line saying WHICH published field
     would show the difference — that is the one thing #4206's hint could not supply for a mutant
     that changes a call rather than an initializer. When the mutated line is not an assignment it
     may still BE a published field (`"session_end": (round(_cur_end) if …)`), so the line's own
     dict key counts. */
  const ownKeys = [...String(halves.before).matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g)].map((k) => k[1]);

  if (!before || !after || before.name !== after.name) {
    return {
      class: 'not-an-initialiser',
      shape,
      publishedFields: ownKeys.map((f) => ({ field: f, line: (state.at || [])[0] ?? null, name: null })),
      reason: `the mutated line is a ${shape}, not an assignment to one name, so what decides it is that expression's own contract rather than a name's reads${ownKeys.length ? `; the line publishes field(s) ${[...new Set(ownKeys)].join(', ')}` : ''}`
    };
  }

  const name = before.name;
  const oldTruth = literalTruth(before.value);
  const newTruth = literalTruth(after.value);
  const reads = readContexts(masked, span, name);
  const fields = publishedFields(lines, reads, name);
  const distinguishing = reads.filter((r) => r.context !== 'truthiness');
  const fieldNames = [...new Set([...ownKeys, ...fields.map((f) => f.field)])];
  const hint = fieldNames.length ? `; it reaches published field(s) ${fieldNames.join(', ')}` : '';
  const base = {
    name,
    oldValue: before.value,
    newValue: after.value,
    oldTruth,
    newTruth,
    reads: reads.length,
    publishedFields: fields.length ? fields : ownKeys.map((f) => ({ field: f, line: null, name }))
  };

  /* BOTH sides expressions ⇒ the mutation changed an ARGUMENT or an operator inside the right-hand
     side (`daemon_starts(prev, data, offset_sec=None)`), so the question is the callee's contract and
     not this name's literal truth. That is a fact about the pair, so it is a class, not a refusal. */
  if (oldTruth === null && newTruth === null) {
    return {
      ...base,
      class: 'not-an-initialiser',
      shape: `${shape} on the right-hand side of \`${name}\``,
      reason: `the mutation changes the expression \`${before.value}\` to \`${after.value}\`, so what decides it is that expression's own contract rather than \`${name}\`'s reads${hint}`
    };
  }
  /* A DISTINGUISHING READ IS ENOUGH ON ITS OWN, whatever the two values' truth — it is a CANDIDATE
     and never a claim that the mutant dies, because the read may sit on a path the mutated value
     never reaches. The truth comparison below is needed only by the EQUIVALENCE claim. */
  if (distinguishing.length) {
    const first = distinguishing[0];
    return {
      ...base,
      class: 'observable',
      firstDistinguishing: first,
      reason: `\`${name}\` has a ${first.context} read at line ${first.line + 1}, so the two values are not interchangeable there${hint}`
    };
  }
  /* 🔴 THIS CHECK SITS ABOVE `write-only` ON PURPOSE. An unread name assigned a LITERAL is dead and
     the mutant is equivalent; an unread name assigned an EXPRESSION is not, because evaluating
     `f(rows, None)` instead of `f(rows, 1)` can raise or write. The selftest's first run put
     write-only first and classed exactly that case as proven-equivalent. */
  if (oldTruth === null || newTruth === null) {
    return {
      ...base,
      class: 'undecided',
      reason: `no read of \`${name}\` can distinguish the two values, and one side of the mutation is \`${oldTruth === null ? before.value : after.value}\`, whose truth this reader cannot decide and whose evaluation it cannot rule out as a side effect`
    };
  }
  if (!reads.length) {
    return {
      ...base,
      class: 'write-only',
      reason: `\`${name}\` is assigned and never read inside \`${fname}\`, and both values are literals, so neither can reach any output`
    };
  }
  if (oldTruth === newTruth) {
    return {
      ...base,
      class: 'truthiness-equivalent',
      reason: `all ${reads.length} read(s) of \`${name}\` in \`${fname}\` test only its truth, and \`${before.value}\` and \`${after.value}\` are both ${oldTruth ? 'truthy' : 'falsy'}, so no input can tell the mutant from the original`
    };
  }
  return {
    ...base,
    class: 'observable',
    firstDistinguishing: null,
    reason: `all reads of \`${name}\` test only its truth, and the two values differ in truth (\`${before.value}\` is ${oldTruth ? 'truthy' : 'falsy'}, \`${after.value}\` is ${newTruth ? 'truthy' : 'falsy'}), so a branch flips${hint}`
  };
}

/* ── 6 · THE CENSUS ─────────────────────────────────────────────────────────────────────────────── */
export function census(entries, readSource) {
  const rows = [];
  for (const e of entries) {
    let src = null;
    try {
      src = readSource(e.module);
    } catch {
      src = null;
    }
    if (src == null) {
      rows.push({ entry: e, verdict: { class: 'unresolved', reason: `the module ${e.module} resolves to no readable file` } });
      continue;
    }
    rows.push({ entry: e, verdict: classifyEntry(src, e) });
  }
  return rows;
}

export function countClasses(rows) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  for (const r of rows) counts[r.verdict.class] = (counts[r.verdict.class] || 0) + 1;
  return counts;
}

/* ── 7 · THE VERDICT ────────────────────────────────────────────────────────────────────────────── */
/** The ONE verdict object, shared by the census and `--verdict-sample` so the sample cannot drift. */
export function censusVerdictObject(rows) {
  const counts = countClasses(rows);
  const eligible = rows.length;
  const excluded = counts.unresolved;
  const checked = eligible - excluded;
  /* `unresolved` is EXCLUDED and named, not failed: a key whose line today's source does not carry is
     the orphan path's business (`mutation-survivors.mjs orphans`), not this reader's. `undecided` IS
     checked and makes the whole census UNKNOWN, because a census that silently dropped the entries it
     could not place would be the examined-nothing shape wearing a measurement's clothes. */
  const status = eligible === 0 ? 'NOT_APPLICABLE' : counts.undecided > 0 ? 'UNKNOWN' : 'PASS';
  const reason =
    eligible === 0
      ? 'no open entry is in scope — there is nothing to classify'
      : counts.undecided > 0
        ? `${counts.undecided} entr(ies) carry a side this reader cannot decide, so the census is incomplete`
        : null;
  return makeVerdict({
    gate: 'mutation-equiv-source',
    tool: 'tools/mutation-equiv-source.mjs',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'undecided_entries', threshold: 0, unit: 'entries', direction: 'lte' },
    result: eligible === 0 ? null : counts,
    evidence: ['mutation-survivors.json', 'tools/mutation-equiv-source.mjs'],
    reason
  });
}

/* ── 8 · SELFTEST ────────────────────────────────────────────────────────────────────────────────
   EVERY LEG CARRIES A CONTROL. A classifier that answers `observable` for everything would pass a
   suite made only of observable fixtures, and `observable` is the answer that costs nothing to be
   wrong about — so each equivalence leg is paired with a flip that must NOT read equivalent, and the
   two masking legs are paired with the prose that would fake a read. */
const FIX = [
  'import os',
  '',
  '',
  'def judge(rows, flag):',
  '    """Prose names quiet and span here, and a quiet span is not a read."""',
  '    # quiet and span are named in this comment too',
  '    span = None',
  '    quiet = None',
  '    seen = None',
  '    note = "no capture data"',
  '    unused = None',
  '    label = "x"',
  '    tag = "plain quiet string does not read quiet"',
  '    if quiet:',
  '        rows = rows[1:]',
  '    if not note:',
  '        rows = []',
  '    if seen is not None:',
  '        rows = []',
  '    span = (rows[0] - rows[1]) if rows else None',
  '    hz, label = 1, "expected"',
  '    if span < 60:',
  '        span = None',
  '    extra = f(rows, 1)',
  '    if extra:',
  '        rows = []',
  '    msg = f"{flag} seen" if flag else tag',
  '    out = {"span_sec": round(span) if span else None, "label": label, "msg": msg}',
  '    return out',
  '',
  '',
  'def other(x):',
  '    quiet = "elsewhere"',
  '    return quiet'
].join('\n');

const K = (before, after) => `- ${before} | + ${after}`;
const E = (before, after, fn = 'judge') => ({ key: K(before, after), function: fn, module: 'fix.py' });

export function selftest() {
  let n = 0;
  let bad = 0;
  const ok = (cond, what) => {
    n += 1;
    if (!cond) {
      bad += 1;
      console.error(`  ✗ ${what}`);
    }
  };
  const eq = (got, want, what) => ok(got === want, `${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const cls = (before, after, fn) => classifyEntry(FIX, E(before, after, fn)).class;

  // ── the two PROOFS, each against the flip that must not reach them ──
  eq(cls('quiet = None', 'quiet = ""'), 'truthiness-equivalent', 'None → "" under truthiness-only reads');
  eq(cls('quiet = None', 'quiet = 1'), 'observable', 'CONTROL: a truth-flipping value is never equivalent');
  eq(cls('note = "no capture data"', 'note = "XXno capture dataXX"'), 'truthiness-equivalent', "mutmut's XX wrap is truthy on both sides");
  eq(cls('note = "no capture data"', 'note = ""'), 'observable', 'CONTROL: truthy → falsy flips the branch');
  eq(cls('unused = None', 'unused = ""'), 'write-only', 'a name with no read at all');
  eq(cls('span = None', 'span = ""'), 'observable', 'CONTROL: write-only must not swallow a name that IS read');

  // ── the read that distinguishes ──
  const seen = classifyEntry(FIX, E('seen = None', 'seen = ""'));
  eq(seen.class, 'observable', '`is not None` distinguishes None from ""');
  eq(seen.firstDistinguishing.context, 'identity', 'and it is named an identity read');
  const spanV = classifyEntry(FIX, E('span = None', 'span = ""'));
  eq(spanV.firstDistinguishing.context, 'value', 'an arithmetic read is a value read');
  ok(
    spanV.publishedFields.some((f) => f.field === 'span_sec'),
    'the field hint names span_sec'
  );
  ok(spanV.reason.includes('span_sec'), 'and the reason carries it');

  // ── a tuple target is a WRITE, not a read ──
  const lab = classifyEntry(FIX, E('label = "x"', 'label = "XXxXX"'));
  eq(lab.class, 'observable', 'label is published, so it is observable');
  eq(
    FIX.split('\n')[lab.firstDistinguishing.line],
    '    out = {"span_sec": round(span) if span else None, "label": label, "msg": msg}',
    'CONTROL: the cited read is the dict line, never the tuple assignment that writes it'
  );
  eq(blankTargets('    hz, label = 1, "expected"', 'label'), '    hz,       = 1, "expected"', 'blankTargets blanks a tuple target');
  eq(blankTargets('    out["label"] = label', 'label'), '    out["label"] = label', 'CONTROL: a subscript target is not a write to the bare name');
  eq(blankTargets('    if label == "x":', 'label'), '    if label == "x":', 'CONTROL: a comparison is not an assignment');

  // ── the shapes that are not initialiser mutations ──
  eq(cls('extra = f(rows, 1)', 'extra = f(rows, None)'), 'not-an-initialiser', 'a call-argument mutant');
  eq(cls('if span < 60:', 'if span <= 60:'), 'not-an-initialiser', 'a comparison-operator mutant');
  eq(cls('unused = None', 'unused = f()'), 'undecided', 'CONTROL: an UNREAD name assigned an expression is not write-only — evaluating it can raise or write');
  const callv = classifyEntry(FIX, E('extra = f(rows, 1)', 'extra = f(rows, None)'));
  eq(callv.shape.includes('call'), true, 'and the shape is named');
  eq(cls('quiet = None', 'quiet = f()'), 'undecided', 'one literal against one expression is a refusal');
  ok(classifyEntry(FIX, E('quiet = None', 'quiet = f()')).reason.includes('cannot decide'), 'and it says so');
  eq(cls('nowhere = None', 'nowhere = ""'), 'unresolved', 'a line today’s function does not carry');
  eq(cls('quiet = None', 'quiet = ""', 'nosuchfn'), 'unresolved', 'a function the module does not carry');

  // ── masking: prose is not code ──
  const masked = maskPython(FIX);
  const span0 = functionSpan(FIX.split('\n'), 'judge');
  const quietReads = readContexts(masked, span0, 'quiet');
  eq(quietReads.length, 1, 'quiet is read once — the docstring, the comment and the plain string are not reads');
  eq(quietReads[0].context, 'truthiness', 'and that read is a truthiness test');
  ok(/Prose names/.test(FIX.split('\n')[4]), 'CONTROL: the docstring really does name it');
  ok(!/quiet/.test(masked[4]), 'CONTROL: and the mask blanked that docstring line');
  ok(!/quiet/.test(masked[5]), 'CONTROL: and the comment');
  ok(!/quiet/.test(masked[12]), 'CONTROL: and the plain string literal');
  eq(bodyStart(masked, span0), 4, "the body starts after the signature's own line");
  ok(/def judge/.test(FIX.split('\n')[3]), 'CONTROL: and that line is the def');
  const flagReads = readContexts(masked, span0, 'flag');
  eq(flagReads.length, 2, "an f-string's braces ARE code: flag is read inside it and in the condition");

  // ── literalTruth, where the equivalence claim rests ──
  for (const v of ['None', 'False', '0', '0.0', '[]', '{}', '()', 'set()', '""', "''"]) eq(literalTruth(v), false, `${v} is falsy`);
  for (const v of ['True', '1', '-2.5', '"x"', '"XXaXX"', '[1]', '{1: 2}', '(1, 2)']) eq(literalTruth(v), true, `${v} is truthy`);
  for (const v of ['f()', 'x', 'a + b', '[c for c in x]', 'None if y else "z"', '']) eq(literalTruth(v), null, `${v} is undecidable`);

  // ── contextOf ──
  eq(contextOf('    if ', ':'), 'truthiness', 'if NAME:');
  eq(contextOf('    x = 1 if ', ' else 2'), 'truthiness', 'a ternary condition');
  eq(contextOf('    if a and ', ':'), 'truthiness', 'a conjunct');
  eq(contextOf('    if not ', ':'), 'truthiness', 'a negation');
  eq(contextOf('    if ', ' is not None:'), 'identity', 'an identity test');
  eq(contextOf('    if a is not ', ':'), 'identity', 'on the right of `is not`');
  eq(contextOf('    y = ', '[0]'), 'value', 'a subscript');
  eq(contextOf('    y = f(', ')'), 'value', 'a call argument');
  eq(contextOf('    y = ', ' - 1'), 'value', 'arithmetic');
  eq(contextOf('    if ', ' < 60:'), 'value', 'a comparison is not a truthiness test');

  // ── the verdict object ──
  const rows = (classes) => classes.map((c, i) => ({ entry: { key: `k${i}` }, verdict: { class: c } }));
  const vPass = censusVerdictObject(rows(['truthiness-equivalent', 'observable', 'unresolved']));
  eq(vPass.status, 'PASS', 'every entry placed ⇒ PASS');
  eq(vPass.population.eligible, 3, 'eligible is every entry in scope');
  eq(vPass.population.excluded, 1, 'an unresolved entry is EXCLUDED and named, not failed');
  eq(vPass.population.checked + vPass.population.excluded, vPass.population.eligible, 'checked + excluded = eligible');
  eq(censusVerdictObject(rows(['undecided', 'observable'])).status, 'UNKNOWN', 'CONTROL: one refusal makes the census UNKNOWN');
  ok(censusVerdictObject(rows(['undecided'])).reason.includes('incomplete'), 'and carries a reason');
  eq(censusVerdictObject([]).status, 'NOT_APPLICABLE', 'no entry in scope is examined-nothing, not a green');
  eq(censusVerdictObject([]).result, null, 'and NOT_APPLICABLE carries no result');
  eq(vPass.criterion.threshold, 0, 'the criterion is pre-stated');
  eq(CLASSES.length, 6, 'the class set is closed');
  eq(JSON.stringify(PROVEN_EQUIVALENT), '["truthiness-equivalent","write-only"]', 'only the two proofs may close an entry');
  for (const c of PROVEN_EQUIVALENT) ok(CLASSES.includes(c), `${c} is one of the classes`);

  // ── the census over a stand-in ledger ──
  const cen = census([E('quiet = None', 'quiet = ""'), E('span = None', 'span = ""'), { key: 'junk', function: 'judge', module: 'missing.py' }], (m) => (m === 'fix.py' ? FIX : null));
  eq(cen.length, 3, 'the census answers for every entry it was given');
  eq(cen[2].verdict.class, 'unresolved', 'an unreadable module is unresolved, never skipped');
  ok(cen[2].verdict.reason.includes('missing.py'), 'and it names the module');

  console.log(bad ? `mutation-equiv-source: ${bad} of ${n} assertions FAILED` : `mutation-equiv-source selftest: ${n} assertions passed`);
  return bad ? 1 : 0;
}

/* ── 9 · CLI ────────────────────────────────────────────────────────────────────────────────────── */
function arg(flag, argv) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

export function resolveModule(moduleName, root) {
  for (const rel of [String(moduleName || ''), path.join('capture-host', String(moduleName || ''))]) {
    const f = path.join(root, rel);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function openEntries(ledger, { lane, fn }) {
  return (ledger.entries || []).filter((e) => e.state === 'open' && (!lane || e.lane === lane) && (!fn || e.function === fn));
}

function cmdCensus(argv) {
  const root = path.join(HERE, '..');
  const ledgerPath = path.join(root, 'mutation-survivors.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const rows = census(openEntries(ledger, { lane: arg('--lane', argv), fn: arg('--function', argv) }), (m) => {
    const f = resolveModule(m, root);
    return f ? fs.readFileSync(f, 'utf8') : null;
  });
  const v = censusVerdictObject(rows);
  /* `--json` emits ONE document with the verdict inside it. Printing the rows and then the verdict
     object on its own line gives a reader two valid JSON texts and a parser one syntax error. */
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ rows: rows.map((r) => ({ key: r.entry.key, mutant: r.entry.mutant, ...r.verdict })), verdict: v }, null, 2));
    return v.status === 'PASS' ? 0 : 1;
  }
  {
    for (const c of CLASSES) {
      const of = rows.filter((r) => r.verdict.class === c);
      if (!of.length) continue;
      console.log(`\n── ${c} · ${of.length} ──`);
      for (const r of of) {
        console.log(`  ${r.entry.mutant || '(no mutant id)'}`);
        console.log(`    ${(splitKey(String(r.entry.key).trimStart()) || { before: r.entry.key }).before.trim()}`);
        console.log(`    ${r.verdict.reason}`);
        const ff = [...new Set((r.verdict.publishedFields || []).map((f) => f.field))];
        if (ff.length) console.log(`    field hint: assert ${ff.join(', ')}`);
      }
    }
    const counts = countClasses(rows);
    console.log(
      `\n${rows.length} open entr(ies) in scope · ` +
        CLASSES.filter((c) => counts[c])
          .map((c) => `${c}: ${counts[c]}`)
          .join(' · ')
    );
    console.log('\nPROVEN equivalent (closeable): ' + rows.filter((r) => PROVEN_EQUIVALENT.includes(r.verdict.class)).length);
  }
  console.log(JSON.stringify(v));
  return v.status === 'PASS' ? 0 : 1;
}

export { cmdCensus };

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: ['--lane', '--function'], boolean: ['--selftest', '--verdict-sample', '--json'], positional: false }, { tool: 'mutation-equiv-source' });
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--verdict-sample')) {
    // A SAMPLE over a two-entry stand-in, built by the SAME function the real census calls, so no
    // second copy of the object can drift from it.
    const stand = [
      { entry: { key: 'x' }, verdict: { class: 'truthiness-equivalent' } },
      { entry: { key: 'y' }, verdict: { class: 'observable' } }
    ];
    console.log(JSON.stringify(censusVerdictObject(stand)));
    process.exit(0);
  }
  process.exit(cmdCensus(argv));
}
