// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/integrator-surface-gate.mjs — every Integrator key declares its surface

       node tools/integrator-surface-gate.mjs            # gate
       node tools/integrator-surface-gate.mjs --json     # verdict only
       node tools/integrator-surface-gate.mjs --selftest
       node tools/integrator-surface-gate.mjs --verdict-sample

   THE CONTRACT (briefs/INTEGRATOR-SURFACE-2026-10-11-BRIEF.md). Every key the
   Integrator's fusion emits declares, in `tools/integrator-surface.json`, which
   surface it reaches:

     card         rendered for a reader — so its own declared reader MUST read it
     export-only  carried on the node-export and deliberately not rendered

   The gate reds on exactly three things: a key with no declaration, a `card` key
   that its reader does not READ, and an `export-only` key that any declared
   reader does read. A `card` key whose only appearance is PROSE — a comment or a
   string — is the second of those, and the reason names it separately, because
   absence and prose are different repairs.

   REALMS. "Its own declared reader" was ONE file until 2026-11-12, and that cost
   two of the 36 cells: `clockSkew` and `kernelAudit` both read `export-only`,
   `integrator-render.js` names neither, and `integrator-app.js` binds both and
   draws a banner line from each. The reader realms are now DECLARED
   (`readerRealms`), the render realm is the default, and a card key names its own
   realm (`readerFiles`). A non-default realm declares the HOLDER its reads must
   anchor on, because a bare token is only evidence inside the file whose job is
   the fusion — measured in the app, `generated`, `kind` and `schema` all match a
   bare token and none of them reads the fusion. A realm set that drops the render
   file REFUSES; a key naming a file outside the set is a reported finding.

   DEPTH. The top level is judged for every key. One level DOWN is judged inside a
   declared subtree only (`nested` in the declaration file; `fusion.apnea` is the
   first), where the same three conditions hold against an ANCHORED read, plus two
   of its own: a key that only some of the builder's return shapes carry must say
   so, and a scope that rebinds the alias credits nothing. The verdict names the
   subtrees it judged — one absent from `result.nestedSubtrees` is not examined.

   🔴 THE SEED IS DERIVED, SO THE FIRST RUN PROVES NOTHING ABOUT TODAY. The
   declarations were seeded by scanning render for each key on 2026-10-11, so
   today's PASS is true by construction — the same shape as residue
   `2026-09-28-generator-compared-to-itself-examines-no-artifact`. What the gate
   can see is DRIFT from that seed: a new key nobody declared, a `card` key whose
   render READ is deleted, or an `export-only` key that render starts to read. All
   three are planted in `--selftest` rather than assumed. The seed was itself
   derived by a scan that counted prose, and two of its fourteen `card` entries
   were wrong for that reason (`reads()` below), so that part of the first green
   is withdrawn rather than inherited.

   ⚠️ IT READS SOURCE, NOT FIXTURES. The brief's key count was first derived from
   `uploads/integrator_fusion_*.json` (110 keys at depth <= 2, 49 unrendered —
   close to the briefed 108/55). That enumeration cannot be a gate: `uploads/` is
   absent in a worktree and in CI, where the scan silently finds one fixture, or
   none, and reports a clean pass over almost nothing examined.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';
import { codeOnly, prepare } from './find-unwired-js.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DECL_PATH = join(ROOT, 'tools/integrator-surface.json');
export const SURFACES = ['card', 'export-only'];

/* 🔴 THE SLIM-EXPORT LITERAL IS A SECOND EXPORT ROUTE, AND THIS GATE READ ONLY THE FIRST. Until
   2026-11-12 the enumerator took the fusion return object plus every `_exp.<key>` ASSIGNMENT. The
   Integrator builds most of its slim export as one object LITERAL (`var _exp = {`), so ten of its
   keys — `confirmedApneaIndex` among them — reached the node-export with no declaration, and the
   gate reported a green PASS over 26 of the 36 keys it was written to judge. A verdict that names
   its population is what makes that visible, so `result.keys` and `result.depth` are both printed.

   Returns null when the text carries no such literal, which is the shape the snippet selftests
   pass. `main()` REFUSES on a null, so the real run fails closed when the literal's shape moves. */
export function exportLiteralKeys(dspText) {
  const lines = dspText.split('\n');
  const open = lines.findIndex((l) => /^\s*var _exp = \{\s*$/.test(l));
  if (open < 0) return null;
  const keys = [];
  let d = 0;
  for (let i = open; i < lines.length; i++) {
    if (i > open && d === 1) {
      const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
      if (m) keys.push(m[1]);
    }
    d += (lines[i].match(/[{[]/g) || []).length - (lines[i].match(/[}\]]/g) || []).length;
    if (i > open && d <= 0) return keys;
  }
  return null;
}

/** The keys the fusion can emit: its return object's own properties, plus every `_exp.<key>`. */
export function fusionKeys(dspText) {
  const lines = dspText.split('\n');
  const anchor = lines.findIndex((l) => /^\s*hrSource: hrSource,?\s*$/.test(l));
  if (anchor < 0) throw new Error('the fusion return object was not found — its shape changed, and this gate must not guess');
  let start = -1;
  for (let i = anchor; i >= 0; i--)
    if (/return \{\s*$/.test(lines[i])) {
      start = i;
      break;
    }
  if (start < 0) throw new Error('no `return {` above the fusion anchor');
  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > start && depth <= 0) {
      end = i;
      break;
    }
  }
  const keys = [];
  let d = 0;
  for (const l of lines.slice(start + 1, end)) {
    if (d === 0) {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
      if (m) keys.push(m.group ? m.group(1) : m[1]);
    }
    d += (l.match(/[{[]/g) || []).length - (l.match(/[}\]]/g) || []).length;
  }
  for (const m of dspText.matchAll(/_exp\.([A-Za-z_][A-Za-z0-9_]*)/g)) keys.push(m[1]);
  const lit = exportLiteralKeys(dspText);
  if (lit) keys.push(...lit);
  return [...new Set(keys)].sort();
}

/** The RAW token test: does the text carry the word at all, in code or in prose. */
export function mentions(renderText, key) {
  return new RegExp('\\b' + escapeRe(key) + '\\b').test(renderText);
}

/* 🔴 A MENTION IS NOT A READ. Measured 2026-11-11 over the fourteen `card` keys: `bus` and
   `staging` satisfied this gate on ENGLISH. `bus` appears once in integrator-render.js, inside the
   device-AHI card's own sentence ("the strongest single apnea truth on the bus"); `staging` appears
   in a block comment about `staging_disagreement` and in a `cite:` string. No Integrator surface
   reads `fusion.bus` or `fusion.staging` at all. A word-boundary test over a whole file cannot tell
   a property access from a tooltip, so `reads()` asks the question on code with comments, strings,
   templates and regex literals BLANKED (`find-unwired-js.mjs prepare` — acorn when the checkout
   resolves one, its hand tokenizer when it does not). A bracket access quotes its own key, so that
   one route is asked of the RAW text, where the quotes still exist. */
export function reads(code, renderText, key) {
  if (new RegExp('\\b' + escapeRe(key) + '\\b').test(code)) return true;
  return new RegExp('\\[\\s*([\'"])' + escapeRe(key) + '\\1\\s*\\]').test(renderText);
}

/* 🔴 A SECOND REALM MAKES A BARE TOKEN WORTHLESS AT DEPTH 1 TOO. The bare-token test above is
   justified by the realm it runs in: inside `integrator-render.js` the fusion object is what the
   file is for, so the token IS the fusion's own property name. `integrator-app.js` is a second
   reader realm and that justification does not travel. Measured 2026-11-12 over the 36 top-level
   keys: `generated`, `kind` and `schema` all match a bare token in the app and none of them is a
   read of the fusion — `generated` and `schema` belong to a synthetic crossnight envelope the app
   BUILDS (integrator-app.js:592) and `kind` names a file type and a download (`:177`, `:367`). So
   a non-default realm is asked for an ANCHORED read against the holder it declares, which is the
   same repair depth 2 already carries, one level up. */
export function readsAnchored(code, rawText, holder, key) {
  const h = escapeRe(holder);
  if (new RegExp(h + '\\s*\\.\\s*' + escapeRe(key) + '(?![A-Za-z0-9_$])').test(code)) return true;
  return new RegExp(h + '\\s*\\[\\s*([\'"])' + escapeRe(key) + '\\1\\s*\\]').test(rawText);
}

/* ── DEPTH 2, ONE SUBTREE AT A TIME ───────────────────────────────────────────────────────────
   🔴 THE GATE JUDGED DEPTH 1 AND SAID SO, WHICH LEFT EVERY NESTED PATH UNDECLARED. Board 5905
   parked the nested half with a reason, and the reason still holds: a scratch resolver reached 183
   paths and left 16 of them unresolved, and each path then needs a hand-checked surface. So the
   nested half arrives ONE SUBTREE at a time, and the verdict NAMES the subtrees it judged at depth
   2 rather than claim a depth for all of them.

   `fusion.apnea` is the first subtree. The slim-export literal forwards six of its members under
   renamed top-level keys, the reader binds the object to one alias at two sites, and it is the
   subtree a reader meets on the headline card.

   🔴 A NESTED READ NEEDS AN ANCHOR, AND A BARE TOKEN IS NOT ONE. At depth 1 a bare token in blanked
   code is good evidence, because the token IS the fusion's own property name. At depth 2 it is not:
   `findings`, `matched`, `total` and `unmatched` are ALSO top-level fusion keys, so a bare token
   cannot tell `fusion.findings` from `a.findings`. `readsNested` resolves the alias, scopes the
   search to the enclosing function, and asks for `<alias>.<key>` or `<alias>['<key>']` in that
   scope. Measured over this subtree on 2026-11-12: the anchored test and the bare one AGREE on all
   14 keys, so the anchoring repairs no live miss here and is a tightening against the next edit.

   🔴 AND THE SHAPES DIFFER, SO PRESENCE IS PART OF THE SURFACE. `fuseApneaEvents` returns from two
   places. Its no-overlap guard carries 13 keys and the fused path 14: `consequence` exists on the
   fused path alone. The guard's own comment says a reader never branches on a key's presence, which
   is true of `contributions` and `overlapCoverage` and false of `consequence`. A key on some shapes
   only must therefore DECLARE that in `partialShape`, or the gate reds. `fusion.apnea` is itself
   null when no overlap exists (`integrator-dsp.js` builds it as `anyOverlap ? … : null`), so every
   path below is conditional on that too, and `nullWhen` records it. */

/* 🔴 A RETURN OBJECT NEED NOT SPAN LINES. `auditNodeKernels` returns all five of its keys on ONE
   line, so an enumerator that anchors `return {` to the END of a line finds no shape at all and the
   gate refused a subtree whose source sat there to read. This reads a one-line literal only when
   its braces BALANCE on that line and it carries no quote — a string could hold a comma or a colon,
   and a reader that cannot tell those apart must refuse rather than guess. */
export function oneLineShape(line) {
  const i = line.indexOf('return {');
  if (i < 0) return null;
  return oneLineObject(line, i + 'return '.length);
}

/* The same reader over ANY object literal that opens at `open` and closes on the same line. An
   element literal is not a return, so this takes the index of the `{` and not a keyword. */
export function oneLineObject(line, open) {
  let d = 0;
  let close = -1;
  for (let j = open; j < line.length; j++) {
    const c = line[j];
    if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') {
      d--;
      if (d === 0) {
        close = j;
        break;
      }
    }
  }
  if (close < 0) return null;
  const body = line.slice(open + 1, close);
  if (!body.trim()) return null;
  if (/['"`]/.test(body)) return null;
  const keys = [];
  let dep = 0;
  let piece = '';
  const take = () => {
    const m = piece.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (m) keys.push(m[1]);
    else if (piece.trim()) keys.push(null);
    piece = '';
  };
  for (const c of body) {
    if (c === '{' || c === '[' || c === '(') dep++;
    else if (c === '}' || c === ']' || c === ')') dep--;
    if (c === ',' && dep === 0) {
      take();
      continue;
    }
    piece += c;
  }
  take();
  /* A piece that is not `name:` is a spread, a shorthand or something this reader does not model.
     One of those and the whole shape refuses, because a partial key list is the defect section 4 of
     the brief already records. */
  if (!keys.length || keys.some((k) => k === null)) return null;
  return keys;
}

/** Every `return {` inside one named function, as depth-1 key lists. Null when the shape moves. */
export function nestedShapes(dspText, fnName) {
  const lines = dspText.split('\n');
  const start = lines.findIndex((l) => new RegExp('^function ' + escapeRe(fnName) + '\\(').test(l));
  if (start < 0) return null;
  let d = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    d += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > start && d <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const shapes = [];
  for (let i = start; i < end; i++) {
    if (!/return \{/.test(lines[i])) continue;
    /* 🔴 A NESTED CALLBACK'S RETURN IS NOT THIS FUNCTION'S SHAPE. `fuseApneaEvents:2268` is
       `.map(function (k) { return { node: k, surges: hrByNode[k] }; })`, and reading it as a shape
       of the builder added two keys that no fusion ever carries and made 15 real keys look
       conditional. The return must sit in THIS function's own scope. An `if` block does not move
       that scope, because `enclosingFn` looks for a function header and not for a brace. */
    const sc = enclosingFn(lines, i);
    if (!sc || sc[0] !== start) continue;
    /* A WHOLLY-INLINE callback keeps its header and its return on ONE line, so `enclosingFn` sees
       no header above and credits the builder. The text in front of the return names the callback,
       which is a reason to skip and not the blindness that hid `auditNodeKernels`. */
    if (/\bfunction\b|=>/.test(lines[i].slice(0, lines[i].indexOf('return {')))) continue;
    /* A `return {` that does NOT end its line is a one-line literal. It reads, or the shape
       refuses — never a silent skip, which is what hid `auditNodeKernels` from this gate. */
    if (!/return \{\s*$/.test(lines[i])) {
      const one = oneLineShape(lines[i]);
      if (!one) return null;
      shapes.push({ at: i + 1, keys: one });
      continue;
    }
    let dd = 0;
    let closed = false;
    const keys = [];
    for (let j = i; j <= end; j++) {
      if (j > i && dd === 1) {
        const m = lines[j].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (m) keys.push(m[1]);
      }
      dd += (lines[j].match(/[{[]/g) || []).length - (lines[j].match(/[}\]]/g) || []).length;
      if (j > i && dd <= 0) {
        closed = true;
        break;
      }
    }
    if (!closed) return null;
    shapes.push({ at: i + 1, keys });
  }
  if (!shapes.length) return null;
  const union = [...new Set(shapes.flatMap((s) => s.keys))].sort();
  return { shapes, union, partial: union.filter((k) => !shapes.every((s) => s.keys.includes(k))) };
}

/* 🔴 AN ELEMENT SHAPE BELONGS TO THE BUILDER'S LITERAL, NOT TO THE ARRAY KEY. `auditNodeKernels`
   builds ONE `entry` object and pushes it into both `nodes[]` and `mismatches[]`, so one shape
   serves two keys and a per-key declaration would state the same four keys twice. This reads that
   literal from SOURCE, like every other shape in this gate.

   It reads a literal that closes on ONE line and refuses otherwise, with a named reason. The
   multi-line form is unbuilt rather than broken: no declaration asks for one yet, and a reader
   that cannot read a shape must say so rather than return a short key list. */
export function elementShape(dspText, fnName, varName, pre = prepare) {
  const lines = pre(dspText).code.split('\n');
  const start = lines.findIndex((l) => new RegExp('^function ' + escapeRe(fnName) + '\\(').test(l));
  if (start < 0) return null;
  let d = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    d += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > start && d <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const re = new RegExp('\\b(?:var|let|const)\\s+' + escapeRe(varName) + '\\s*=\\s*\\{');
  const hits = [];
  for (let i = start; i <= end; i++) {
    const m = re.exec(lines[i]);
    if (m) hits.push({ at: i, open: m.index + m[0].length - 1 });
  }
  /* No assignment is a moved builder; two are ambiguous. Both refuse, as `inlineShape` does. */
  if (hits.length !== 1) return null;
  /* A BLANKED LINE INDEX IS NOT A RAW LINE INDEX. The acorn route blanks in place and leaves every
     offset where the raw file put it; the tokenizer fallback DELETES comment lines. CI installs no
     node_modules, so it always takes the fallback — and reading `dspText`'s line by a blanked index
     read a different line there and threw. The keys are identifiers, which blanking never touches,
     so they come off the BLANKED line. */
  const keys = oneLineObject(lines[hits[0].at], hits[0].open);
  if (!keys) return null;
  /* `at` is for a human, so it must be the RAW line. Unique in the raw text, or null — never a
     guess, and never a reason to refuse keys the blanked text already read. */
  const rawLines = dspText.split('\n');
  const rawHits = [];
  for (let i = 0; i < rawLines.length; i++) if (re.test(rawLines[i])) rawHits.push(i);
  return { at: rawHits.length === 1 ? rawHits[0] + 1 : null, keys };
}

/* 🔴 AN ELEMENT LITERAL CAN SIT AT THE PUSH SITE, AND TWO PUSH SITES CAN DISAGREE.
   `auditNodeKernels` builds one `var entry = {` that `elementShape` reads. `detectClockSkew` does
   not: it pushes an object literal straight into `findings[]` at TWO sites, each spanning many
   lines, and the two key lists differ. The pairwise estimator pushes six keys; the RTC-readback
   pass pushes those six plus `source` and `rtcVerifiedAtMs`. So the element shape here is a UNION
   over sites, and a key that is absent from some site is PARTIAL in exactly the sense depth 2
   already means by it.

   This reads RAW source, like `nestedShapes` beside it and unlike `elementShape`. There is no
   blanking, so there is no blanked-versus-raw line hazard here at all (board 6051).

   It refuses, with no shape, on: a builder it cannot find, a literal that does not close, a
   one-line literal it cannot read, and no push site at all. A refusal is never a short key list. */
export function pushShapes(dspText, fnName, arrayVar) {
  const lines = dspText.split('\n');
  const start = lines.findIndex((l) => new RegExp('^function ' + escapeRe(fnName) + '\\(').test(l));
  if (start < 0) return null;
  let d = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    d += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > start && d <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  /* 🔴 A PUSH IS SCOPED BY ITS ARRAY, NOT BY ITS FUNCTION — the opposite of `nestedShapes`.
     `detectClockSkew` declares `var findings = []` and returns it, and BOTH pushes sit inside
     `.forEach` callbacks within it. Reading a push the way a return is read found no shape at all
     here, because `enclosingFn` named the callback. So a push anywhere inside the builder counts,
     and the guard moves to the array NAME: a second declaration of it inside the builder could
     shadow the array that is returned, so the shape refuses rather than mixing two arrays. */
  const own = new RegExp('\\b(?:var|let|const)\\s+' + escapeRe(arrayVar) + '\\b');
  let decls = 0;
  for (let i = start; i <= end; i++) if (own.test(lines[i])) decls++;
  if (decls !== 1) return null;
  const re = new RegExp('\\b' + escapeRe(arrayVar) + '\\s*\\.\\s*push\\(\\s*\\{');
  const shapes = [];
  for (let i = start; i < end; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    if (!/push\(\s*\{\s*$/.test(lines[i])) {
      const one = oneLineObject(lines[i], open);
      if (!one) return null;
      shapes.push({ at: i + 1, keys: one });
      continue;
    }
    let dd = 0;
    let closed = false;
    const keys = [];
    for (let j = i; j <= end; j++) {
      if (j > i && dd === 1) {
        const km = lines[j].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (km) keys.push(km[1]);
      }
      dd += (lines[j].match(/[{[]/g) || []).length - (lines[j].match(/[}\]]/g) || []).length;
      if (j > i && dd <= 0) {
        closed = true;
        break;
      }
    }
    if (!closed) return null;
    shapes.push({ at: i + 1, keys });
  }
  if (!shapes.length) return null;
  return mergeShapes(shapes);
}

/* One element shape out of several BUILD SITES, which is what `partial` means at this depth. A key
   that only some site writes can be absent from the object a reader holds, exactly as a depth-2
   key that only some return shape carries can be. The sites are kept so a reader of the report can
   go to each line. */
export function mergeShapes(shapes) {
  if (!shapes || !shapes.length) return null;
  const keys = [...new Set(shapes.flatMap((s) => s.keys))].sort();
  return {
    at: shapes[0].at,
    keys,
    siteAt: shapes.map((s) => s.at),
    sites: shapes.map((s) => ({ at: s.at, keys: s.keys.slice().sort(), via: s.via || 'push' })),
    partial: keys.filter((k) => !shapes.every((s) => s.keys.includes(k)))
  };
}

/* 🔴 AN ELEMENT LITERAL CAN ALSO BE THE RETURN OF A `.map` CALLBACK, AND NEITHER EARLIER READER
   SEES IT. `elementShape` wants a one-line `var entry = {`, and `pushShapes` wants
   `<array>.push({`. `detectClockSkew` builds `vetoes` with a `.map` return literal AND a push, and
   it builds `seamCensus` with a `.map` return literal alone. So the element shape of two of the
   three clockSkew arrays had no reader at all.

   The span is the array's own DECLARATION STATEMENT, and not the builder function: a `.map` in a
   later statement builds a different array. The reader refuses rather than guessing on four
   states, each one a selftest leg: no declaration of that array in the builder, more than one
   declaration (a shadow), no `.map(` or several inside the statement (ambiguous), and a literal
   that does not close.

   The `.filter` callback beside the `.map` also holds a `return`, so the literal is taken from
   AFTER the map line and never from the first return in the span. */
export function mapShapes(dspText, fnName, arrayVar) {
  const lines = dspText.split('\n');
  const start = lines.findIndex((l) => new RegExp('^function ' + escapeRe(fnName) + '\\(').test(l));
  if (start < 0) return null;
  let d = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    d += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > start && d <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const own = new RegExp('\\b(?:var|let|const)\\s+' + escapeRe(arrayVar) + '\\s*=');
  const decl = [];
  for (let i = start; i <= end; i++) if (own.test(lines[i])) decl.push(i);
  if (decl.length !== 1) return null;
  /* The statement ends where every bracket it opened has closed and the line carries a `;`. */
  let dd = 0;
  let last = -1;
  for (let j = decl[0]; j <= end; j++) {
    dd += (lines[j].match(/[{[(]/g) || []).length - (lines[j].match(/[}\])]/g) || []).length;
    if (dd <= 0 && /;\s*$/.test(lines[j])) {
      last = j;
      break;
    }
  }
  if (last < 0) return null;
  const mapAt = [];
  let mapCalls = 0;
  for (let j = decl[0]; j <= last; j++) {
    const n = (lines[j].match(/\.\s*map\s*\(/g) || []).length;
    if (!n) continue;
    mapCalls += n;
    mapAt.push(j);
  }
  if (mapCalls !== 1) return null;
  for (let j = mapAt[0]; j <= last; j++) {
    const m = /\breturn\s*\{/.exec(lines[j]);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    if (!/return\s*\{\s*$/.test(lines[j])) {
      const one = oneLineObject(lines[j], open);
      if (!one) return null;
      return mergeShapes([{ at: j + 1, keys: one, via: 'map' }]);
    }
    let od = 0;
    const keys = [];
    for (let k = j; k <= last; k++) {
      if (k > j && od === 1) {
        const km = lines[k].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (km) keys.push(km[1]);
      }
      od += (lines[k].match(/[{[]/g) || []).length - (lines[k].match(/[}\]]/g) || []).length;
      if (k > j && od <= 0) return mergeShapes([{ at: j + 1, keys, via: 'map' }]);
    }
    return null;
  }
  return null;
}

/* 🔴 A TOP-LEVEL EXPORT ARRAY HAS NEITHER OF THE TWO SHAPE SOURCES THIS GATE HELD. `inlineShape`
   wants a `<key>: {` object literal and `nestedShapes` wants a builder function. The export writes
   `findings: fusion.findings.map(function (f) { return { … } })` inside the slim-export literal,
   which is neither of those, so the 11 keys a consumer receives had no shape source at all.

   This reader takes ONE entry of that literal and reads the return shape of the single `.map(`
   inside it. It REFUSES rather than guessing: when the literal is absent or doubled, when the
   entry is absent or doubled, when the entry holds no `.map(` or more than one, or when nothing
   closes. A refusal reaches the caller as a named throw, exactly as a declared-but-unreadable
   element route does. */
export function exportMapShape(dspText, key, literalVar = '_exp') {
  const lines = dspText.split('\n');
  const open = new RegExp('^\\s*(?:var|let|const)\\s+' + escapeRe(literalVar) + '\\s*=\\s*\\{\\s*$');
  const lits = [];
  for (let i = 0; i < lines.length; i++) if (open.test(lines[i])) lits.push(i);
  if (lits.length !== 1) return null;
  let d = 0;
  let end = -1;
  for (let i = lits[0]; i < lines.length; i++) {
    d += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i > lits[0] && d <= 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const ent = new RegExp('^\\s*' + escapeRe(key) + '\\s*:');
  const at = [];
  for (let i = lits[0] + 1; i <= end; i++) if (ent.test(lines[i])) at.push(i);
  if (at.length !== 1) return null;
  /* The entry ends where every bracket it opened has closed again. */
  let bd = 0;
  let last = -1;
  for (let j = at[0]; j <= end; j++) {
    bd += (lines[j].match(/[{[(]/g) || []).length - (lines[j].match(/[}\])]/g) || []).length;
    if (bd <= 0) {
      last = j;
      break;
    }
  }
  if (last < 0) return null;
  let mapCalls = 0;
  let mapAt = -1;
  for (let j = at[0]; j <= last; j++) {
    const n = (lines[j].match(/\.\s*map\s*\(/g) || []).length;
    if (!n) continue;
    mapCalls += n;
    if (mapAt < 0) mapAt = j;
  }
  if (mapCalls !== 1) return null;
  for (let j = mapAt; j <= last; j++) {
    const m = /\breturn\s*\{/.exec(lines[j]);
    if (!m) continue;
    const o = m.index + m[0].length - 1;
    if (!/return\s*\{\s*$/.test(lines[j])) {
      const one = oneLineObject(lines[j], o);
      return one ? mergeShapes([{ at: j + 1, keys: one, via: 'export-map' }]) : null;
    }
    let od = 0;
    const keys = [];
    for (let k = j; k <= last; k++) {
      if (k > j && od === 1) {
        const km = lines[k].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (km) keys.push(km[1]);
      }
      od += (lines[k].match(/[{[]/g) || []).length - (lines[k].match(/[}\]]/g) || []).length;
      if (k > j && od <= 0) return mergeShapes([{ at: j + 1, keys, via: 'export-map' }]);
    }
    return null;
  }
  return null;
}

/* 🔴 AN ELEMENT READ DOES NOT HAVE TO BE A CALLBACK, AND THE CENSUS MISSED TWO OF THREE.
   `callbackSites` matches eight iterator names, so an INDEXED FOR LOOP is invisible to it.
   `skewSilenceLines` binds `vetoes = cs.vetoes || []` and `census = cs.seamCensus || []`, then
   reads `v = vetoes[i] || {}` and `e = census[c] || {}` and takes six keys off the two elements.
   The gate reported ONE unjudged element read where THREE array keys are read element-wise, so the
   stated hole was itself under-reporting.

   This finds the form so the census COUNTS it. It does not judge it: binding keys through an index
   needs a declaration that somebody hand-read, which a later unit writes.

   The index read must sit in the SAME function as the binding. Searching the rest of the file
   would credit any later use of a common name like `v`. */
function indexedScan(text, prefixes, arrayKey) {
  const alt = prefixes.filter(Boolean).map(escapeRe).join('|');
  if (!alt) return [];
  const lines = text.split('\n');
  const bind = new RegExp('\\b(?:var|let|const)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(' + alt + ')\\s*\\.\\s*' + escapeRe(arrayKey) + '\\b');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = bind.exec(lines[i]);
    if (!m) continue;
    const sc = enclosingFn(lines, i);
    const last = sc ? sc[1] : lines.length - 1;
    const idx = new RegExp('\\b' + escapeRe(m[1]) + '\\s*\\[\\s*[A-Za-z_$][A-Za-z0-9_$]*\\s*\\]');
    let at = -1;
    for (let j = i + 1; j <= last; j++)
      if (idx.test(lines[j])) {
        at = j;
        break;
      }
    if (at < 0) continue;
    out.push({ prefix: m[2], iterator: 'index', param: m[1], line: i + 1, elemLine: at + 1 });
  }
  return out;
}

/** Indexed element-read sites, paired across the two texts exactly as `elementCallbacks` pairs the
    callback form. Discovery runs on the BLANKED text, so a commented-out index read cannot credit
    an element read; the line a human reads comes from the RAW text, paired by ORDER, and is null
    when the two counts disagree. A blanked line index is not a raw line index under the tokenizer
    route CI takes (board 6051). */
export function indexedSites(text, prefixes, arrayKey, pre = prepare) {
  const blanked = indexedScan(pre(text).code, prefixes, arrayKey);
  const raw = indexedScan(text, prefixes, arrayKey);
  const paired = raw.length === blanked.length;
  return blanked.map((s, i) =>
    Object.assign({}, s, {
      rawLine: paired ? raw[i].line : null,
      rawElemLine: paired ? raw[i].elemLine : null
    })
  );
}

/* 🔴 COUNTING A READ IS NOT JUDGING IT, AND THE DIFFERENCE IS THE BOUND ELEMENT. `indexedSites`
   above finds the SITE and reads no key off it, which is why #5002 could only count. A callback
   site carries its element in a parameter, so `readsElementKey` tests `m.node` against `m`. An
   indexed loop carries it in a local binding instead — `var v = vetoes[i] || {}` — so this reader
   returns that binding as `param`, with the same `from`/`to` offsets a callback site carries. One
   reader then credits both forms.

   THE SCOPE IS THE LOOP BODY, AND NOT THE FUNCTION. Starting one brace deep, the body closes where
   the depth returns to zero. A binding whose body never closes inside the builder is refused
   rather than scoped to the function, because a common name like `v` would then credit any later
   use of it. */
function indexedElementScan(text, prefixes, arrayKey) {
  const alt = prefixes.filter(Boolean).map(escapeRe).join('|');
  if (!alt) return [];
  const lines = text.split('\n');
  const starts = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const bind = new RegExp('\\b(?:var|let|const)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(' + alt + ')\\s*\\.\\s*' + escapeRe(arrayKey) + '\\b');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = bind.exec(lines[i]);
    if (!m) continue;
    const sc = enclosingFn(lines, i);
    const last = sc ? sc[1] : lines.length - 1;
    const el = new RegExp('\\b(?:var|let|const)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*' + escapeRe(m[1]) + '\\s*\\[\\s*[A-Za-z_$][A-Za-z0-9_$]*\\s*\\]');
    for (let j = i + 1; j <= last; j++) {
      const em = el.exec(lines[j]);
      if (!em) continue;
      let d = 1;
      let end = -1;
      for (let k = j; k <= last; k++) {
        d += (lines[k].match(/\{/g) || []).length - (lines[k].match(/\}/g) || []).length;
        if (d <= 0) {
          end = k;
          break;
        }
      }
      if (end < 0) continue;
      out.push({
        prefix: m[2],
        iterator: 'index',
        param: em[1],
        array: m[1],
        from: starts[j],
        to: starts[end] + lines[end].length - 1,
        line: j + 1,
        bindLine: i + 1
      });
    }
  }
  return out;
}

/** Indexed element-read sites with the element BOUND, paired across the two texts exactly as
    `elementCallbacks` pairs the callback form, and shaped the same so `readsElementKey` consumes
    both without knowing which form it holds. */
export function indexedElements(text, prefixes, arrayKey, pre = prepare) {
  const blanked = indexedElementScan(pre(text).code, prefixes, arrayKey);
  const raw = indexedElementScan(text, prefixes, arrayKey);
  const paired = raw.length === blanked.length;
  return blanked.map((s, i) =>
    Object.assign({}, s, {
      rawFrom: paired ? raw[i].from : null,
      rawTo: paired ? raw[i].to : null,
      rawLine: paired ? raw[i].line : null
    })
  );
}

/* 🔴 THE SECOND SUBTREE NEEDED THREE MECHANISMS THE FIRST ONE DID NOT. `fusion.clockSkew` is an
   inline literal with no builder (`inlineShape`), its whole reader surface sits in
   `integrator-app.js` rather than in the render file (`readerFile`), and the app binds it behind a
   `&&` guard and then hands it to a helper one scope on (`forwardedSites`, one hop only). It also
   found a defect in the FIRST subtree's reader: `enclosingFn` took the nearest function header
   above a line, and a callback that had already closed made the binding read as unscoped.

/* 🔴 A SUBTREE NEED NOT HAVE A BUILDER. `fusion.clockSkew` is an inline object literal AT the
   publish site, so `nestedShapes` has no function to read. This reads the literal itself, in
   BLANKED code, and refuses on two states rather than guessing: no anchor line (the shape moved)
   or a literal that does not close.

   🔴 MORE THAN ONE ANCHOR IS NOT AMBIGUITY — IT IS THE EXPORT'S TWO ROUTES. `window` sits in the
   full export of `runFusion` AND in the slim `var _exp = {` projection, and the two key lists
   DIFFER: the projection adds `start` and `end`, which `fmtDateTime` computes there. An earlier
   reader took a second anchor as ambiguity and refused, which hid a real difference behind a tool
   limit. So every anchor becomes a shape, the union is the surface, and `partial` names the keys
   one route omits — exactly what `partial` already means over several element build routes.

   🔴 AND PRESENCE IS CONDITIONAL HERE FOR A SECOND REASON. One literal carries one key list, so
   no key of it alone can be missing. A key whose VALUE can be `undefined` is the
   same defect wearing different clothes: `vetoes: skew.vetoes && skew.vetoes.length ?
   skew.vetoes : undefined` leaves the export entirely when nothing was refused, while
   `seamCensus: skew.seamCensus || []` ships even empty. So `partial` here means "can evaluate to
   `undefined`", and `partialKind` names which mechanism produced it. `null` is NOT in that set —
   a null is a value a consumer can read, which is the whole of §∅. */
export function inlineShape(dspText, key, pre = prepare) {
  const lines = pre(dspText).code.split('\n');
  const ranges = literalRanges(lines, key);
  if (!ranges) return null;
  const shapes = [];
  const undefinedValued = new Set();
  for (const [start, end] of ranges) {
    const { keys, values } = literalKeys(lines, start, end);
    if (!keys.length) return null;
    shapes.push({ at: start + 1, keys });
    for (const k of keys) if (/\bundefined\b/.test(values[k] || '')) undefinedValued.add(k);
  }
  const union = [...new Set(shapes.flatMap((s) => s.keys))].sort();
  const routeMissing = union.filter((k) => !shapes.every((s) => s.keys.includes(k)));
  const canBeUndefined = union.filter((k) => undefinedValued.has(k));
  /* 🔴 TWO MECHANISMS CANNOT WEAR ONE `partialKind`. A reader of the verdict is told WHY a key is
     conditional, and "absent from one export route" and "can evaluate to `undefined`" call for
     different remedies. No subtree carries both today, so this names itself rather than picking
     one word for two states and reporting a reason that is wrong for half the keys. */
  if (routeMissing.length && canBeUndefined.length)
    throw new Error(
      `inline subtree \`${key}\` has keys conditional for TWO different reasons — ${routeMissing.join(', ')} ${routeMissing.length === 1 ? 'is' : 'are'} absent from one export route and ${canBeUndefined.join(', ')} can evaluate to \`undefined\` — and one \`partialKind\` cannot state both`
    );
  return {
    shapes,
    union,
    partial: routeMissing.length ? routeMissing : canBeUndefined,
    partialKind: routeMissing.length ? 'export-route' : 'undefined-value',
    shapeKind: 'inline'
  };
}

/* 🔴 DEPTH 3 OF AN OBJECT, NOT OF AN ARRAY. The element layer reads what a reader takes out of an
   ARRAY element, and `fusion.schema` carries no array: one of its six keys, `method`, is an object
   literal holding seven more. The gate judged `method` as a single key and saw nothing inside it,
   so a method note added or dropped moved no number here. The inner layer is OPT-IN, and a subtree
   with no `inner` block is judged exactly as before. */
/** The PREPARED line that closes the literal opening on line `i`, or -1 while it stays open. */
function closeOf(lines, i) {
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/[{[]/g) || []).length - (lines[j].match(/[}\]]/g) || []).length;
    if (j > i && d <= 0) return j;
  }
  return -1;
}

/* 🔴 A LITERAL CLOSED ON ITS OWN LINE IS STILL A LITERAL. `handshakes` writes both of its inner
   objects as `glucodex_ready: { glucose_autonomic_correlation: … }`, and the open-ended anchor
   below matches neither, so every reader answered `null` and both inner keys went unjudged. The
   one-line form is deliberately NARROW: a body carrying another literal keeps the old refusal,
   because a nested brace needs the multi-line depth walk that `closeOf` does. */
/** Every `key: { … }` literal's [start, end] line range, in PREPARED lines. Null when one is open. */
function literalRanges(lines, key) {
  const anchor = new RegExp('^\\s*' + escapeRe(key) + ':\\s*\\{\\s*$');
  const oneLine = new RegExp('^\\s*' + escapeRe(key) + ':\\s*\\{[^{}]*\\}\\s*,?\\s*$');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (oneLine.test(lines[i])) {
      out.push([i, i]);
      continue;
    }
    if (!anchor.test(lines[i])) continue;
    const end = closeOf(lines, i);
    if (end < 0) return null;
    out.push([i, end]);
  }
  return out.length ? out : null;
}

/** The depth-1 keys of a literal written on ONE line, each with its value text. */
function oneLineKeys(line) {
  const open = line.indexOf('{');
  const close = line.lastIndexOf('}');
  const keys = [];
  const values = {};
  if (open < 0 || close <= open) return { keys, values };
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of line.slice(open + 1, close)) {
    if ('(['.includes(ch)) depth++;
    else if (')]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  for (const part of parts) {
    const m = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:([\s\S]*)$/);
    if (!m) continue;
    keys.push(m[1]);
    values[m[1]] = m[2];
  }
  return { keys, values };
}

/** The depth-1 keys of one literal range, each with its value text. */
function literalKeys(lines, start, end) {
  if (start === end) return oneLineKeys(lines[start]);
  const keys = [];
  const values = {};
  let dd = 0;
  let cur = null;
  for (let j = start; j <= end; j++) {
    if (j > start && dd === 1) {
      const m = lines[j].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/);
      if (m) {
        cur = m[1];
        keys.push(cur);
        values[cur] = m[2];
      } else if (cur) values[cur] += '\n' + lines[j];
    } else if (cur && j > start) values[cur] += '\n' + lines[j];
    dd += (lines[j].match(/[{[]/g) || []).length - (lines[j].match(/[}\]]/g) || []).length;
  }
  return { keys, values };
}

/** The shape of an object literal nested INSIDE a declared subtree's own literal. */
export function innerShape(dspText, subtree, inner, pre = prepare) {
  const lines = pre(dspText).code.split('\n');
  const outer = literalRanges(lines, subtree);
  if (!outer) return null;
  const shapes = [];
  const undefinedValued = new Set();
  for (const [s0, e0] of outer) {
    /* 🔴 THE SEARCH RUNS INSIDE THE PARENT RANGE, IN THE SAME PREPARED LINES. Slicing raw text by
       a prepared index would shift every line under the tokenizer route, which DELETES comment
       lines instead of blanking them in place. Slicing the prepared array keeps the two aligned,
       and anchoring inside the parent keeps a same-named literal elsewhere out of this shape. */
    const within = literalRanges(lines.slice(s0, e0 + 1), inner);
    if (!within) continue;
    for (const [s1, e1] of within) {
      const { keys, values } = literalKeys(lines, s0 + s1, s0 + e1);
      if (!keys.length) continue;
      shapes.push({ at: s0 + s1 + 1, keys });
      for (const k of keys) if (/\bundefined\b/.test(values[k] || '')) undefinedValued.add(k);
    }
  }
  if (!shapes.length) return null;
  const union = [...new Set(shapes.flatMap((x) => x.keys))].sort();
  /* 🔴 A PARENT ROUTE THAT CARRIES NO INNER LITERAL AT ALL makes EVERY inner key conditional, and a
     union over the routes that DO carry it would hide that: a consumer reading the other route gets
     no inner object whatever. So the count of inner literals is held against the count of parent
     literals, and not only the key lists against each other. */
  const routeMissing = shapes.length < outer.length ? union.slice() : union.filter((k) => !shapes.every((x) => x.keys.includes(k)));
  const canBeUndefined = union.filter((k) => undefinedValued.has(k));
  /* A parent on two export routes can carry the inner literal on one route alone, which is the
     `export-route` state the parent states one level up. Two reasons at once name themselves here
     rather than wear one word, exactly as `inlineShape` refuses to pick between them. */
  if (routeMissing.length && canBeUndefined.length)
    throw new Error(
      `inner literal \`${subtree}.${inner}\` has keys conditional for TWO different reasons — ${routeMissing.join(', ')} ${routeMissing.length === 1 ? 'is' : 'are'} absent from one export route and ${canBeUndefined.join(', ')} can evaluate to \`undefined\` — and one \`partialKind\` cannot state both`
    );
  return {
    shapes,
    union,
    keys: union,
    at: shapes[0].at,
    partial: routeMissing.length ? routeMissing : canBeUndefined,
    partialKind: routeMissing.length ? 'export-route' : 'undefined-value',
    shapeKind: 'inner'
  };
}

/* 🔴 THE NEAREST HEADER IS NOT THE ENCLOSING ONE. `integrator-app.js:88` binds the skew subtree
   nine lines under a `forEach(function (m) {` callback that closed at :82, and a scan that stopped
   at the first header above reported the site UNSCOPED and credited nothing. So walk every header
   upward and take the first whose brace span CONTAINS the line, which is the tightest real scope.
   Null still means no enclosing function contains it, and the caller then refuses the site. */
/** The enclosing function of a line, in BLANKED code lines. Null when none contains the line. */
/* 🔴 THE LITERAL DOES NOT ALWAYS OPEN ON THE KEY'S OWN LINE. `inlineShape` anchors on
   `key: {`, so a key whose literal sits behind a GUARD has no shape at all: the slim export
   writes `apneaTyping: fusion.apneaTyping ? {` and opens the object on the next line. The gate
   reported no anchor and refused, which reads as "the shape moved" and is wrong — the shape is
   one line further down.

   The guard's ALTERNATIVE is a refusal and not a second shape. `: null` is the absence rule and
   carries no key, while `: { … }` would be a second key list behind one key, which this reader
   must not merge silently. So the line after the consequent closes must start the alternative
   with something other than a brace. */
export function guardedShape(dspText, key, pre = prepare) {
  const lines = pre(dspText).code.split('\n');
  const head = new RegExp('^\\s*' + escapeRe(key) + ':\\s*[^\\s{][^{]*$');
  /* 🔴 THE WHOLE GUARD CAN SIT ON ONE LINE. The slim export writes `kernel:` with its guard, its
     consequent literal and its `: null` alternative on ONE line, so the two-line anchor above reads
     nothing there. The one-line form keeps both rules of this reader: the alternative must still
     start with something other than a brace, and a consequent holding a nested literal keeps the
     refusal, because `[^{}]*` matches no inner brace. */
  const oneLineGuard = new RegExp('^\\s*' + escapeRe(key) + ':\\s*[^{]*\\?\\s*\\{[^{}]*\\}\\s*:\\s*[^{\\s].*$');
  const shapes = [];
  const undefinedValued = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (oneLineGuard.test(lines[i])) {
      const { keys, values } = literalKeys(lines, i, i);
      if (!keys.length) return null;
      shapes.push({ at: i + 1, keys });
      for (const k of keys) if (/\bundefined\b/.test(values[k] || '')) undefinedValued.add(k);
      continue;
    }
    if (!head.test(lines[i])) continue;
    let o = i + 1;
    while (o < lines.length && !lines[o].trim()) o++;
    if (!/^\s*\?\s*\{\s*$/.test(lines[o] || '')) continue;
    const end = closeOf(lines, o);
    if (end < 0) return null;
    let a = end + 1;
    while (a < lines.length && !lines[a].trim()) a++;
    if (!/^\s*:\s*[^{\s]/.test(lines[a] || '')) return null;
    const { keys, values } = literalKeys(lines, o, end);
    if (!keys.length) return null;
    shapes.push({ at: i + 1, keys });
    for (const k of keys) if (/\bundefined\b/.test(values[k] || '')) undefinedValued.add(k);
  }
  if (!shapes.length) return null;
  const union = [...new Set(shapes.flatMap((x) => x.keys))].sort();
  const routeMissing = union.filter((k) => !shapes.every((x) => x.keys.includes(k)));
  const canBeUndefined = union.filter((k) => undefinedValued.has(k));
  if (routeMissing.length && canBeUndefined.length)
    throw new Error(
      `guarded subtree \`${key}\` has keys conditional for TWO different reasons — ${routeMissing.join(', ')} absent from one guarded site and ${canBeUndefined.join(', ')} able to evaluate to \`undefined\` — and one \`partialKind\` cannot state both`
    );
  return {
    shapes,
    union,
    keys: union,
    at: shapes[0].at,
    partial: routeMissing.length ? routeMissing : canBeUndefined,
    partialKind: routeMissing.length ? 'export-route' : 'undefined-value',
    shapeKind: 'guarded'
  };
}

/* 🔴 A PRODUCER CAN RETURN A VARIABLE, AND `nestedShapes` READS ONLY A RETURNED LITERAL.
   `typeApneaByEffort` builds `var out = { … }`, counts over the desats, and returns `out`, so the
   function's own shape had no reader: the full fusion object carries that object verbatim.

   The literal is the whole shape ONLY while nothing adds a key to it afterwards. A later
   `out.<newKey> = …` would make this reader report a short key list, which is the one outcome a
   shape reader must never produce, so that state throws instead. A `++` on a key the literal
   already carries is arithmetic and not a new key. */
export function returnVarShape(dspText, fnName, varName, pre = prepare) {
  const lines = pre(dspText).code.split('\n');
  const start = lines.findIndex((l) => new RegExp('^function ' + escapeRe(fnName) + '\\(').test(l));
  if (start < 0) return null;
  let fnEnd = lines.length - 1;
  for (let j = start + 1; j < lines.length; j++)
    if (/^\}/.test(lines[j])) {
      fnEnd = j;
      break;
    }
  const open = new RegExp('^\\s*(?:var|let|const)\\s+' + escapeRe(varName) + '\\s*=\\s*\\{\\s*$');
  const sites = [];
  for (let i = start; i <= fnEnd; i++) if (open.test(lines[i])) sites.push(i);
  if (sites.length !== 1) return null;
  const end = closeOf(lines, sites[0]);
  if (end < 0 || end > fnEnd) return null;
  const ret = new RegExp('^\\s*return\\s+' + escapeRe(varName) + '\\s*;?\\s*$');
  let returned = false;
  for (let i = end + 1; i <= fnEnd; i++) if (ret.test(lines[i])) returned = true;
  if (!returned) return null;
  const { keys, values } = literalKeys(lines, sites[0], end);
  if (!keys.length) return null;
  const add = new RegExp('^\\s*' + escapeRe(varName) + '\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=[^=]');
  const added = [];
  for (let i = end + 1; i <= fnEnd; i++) {
    const m = lines[i].match(add);
    if (m && !keys.includes(m[1]) && !added.includes(m[1])) added.push(m[1]);
  }
  if (added.length)
    throw new Error(`\`${fnName}\` adds ${added.join(', ')} to \`${varName}\` after its literal, so the literal is not the whole shape and this reader must not report a short key list`);
  const canBeUndefined = keys.filter((k) => /\bundefined\b/.test(values[k] || ''));
  return {
    shapes: [{ at: sites[0] + 1, keys }],
    union: keys.slice().sort(),
    keys: keys.slice().sort(),
    at: sites[0] + 1,
    partial: canBeUndefined,
    partialKind: 'undefined-value',
    shapeKind: 'return-var'
  };
}

/* 🔴 ONE SUBTREE, TWO EXPORT ROUTES, TWO DIFFERENT SOURCE FORMS. `window` taught the gate that two
   anchors of the SAME form are the export's two routes and that the union is the surface.
   `apneaTyping` is the next state: the fusion object carries the producer's object through a
   variable, and the slim projection enumerates its keys behind a guard. Neither single reader can
   see both, and a subtree judged on one route reports the other route's keys as absent.

   So a subtree may declare a LIST of routes, each naming exactly one source form. The union is the
   surface, and a key absent from one route is `partial` with `partialKind: 'export-route'` — the
   same word the one-reader case already used for the same fact. A route the declared reader cannot
   read returns `failed`, which the loader turns into a located refusal naming that route. */
export function routeShapes(dspText, routes, pre = prepare) {
  if (!Array.isArray(routes) || !routes.length) return null;
  const got = [];
  const undefPartial = new Set();
  for (const r of routes) {
    const picked = [r.inline && 'inline', r.guarded && 'guarded', r.builtBy && 'builtBy', r.returnVar && 'returnVar'].filter(Boolean);
    if (picked.length !== 1) throw new Error(`a route must declare exactly one of inline, guarded, builtBy or returnVar — this one declares ${picked.length ? picked.join(' and ') : 'none'}`);
    const kind = picked[0];
    const names = kind === 'returnVar' ? `${r.returnVar.fn}.${r.returnVar.via}` : String(r[kind]);
    if (kind === 'returnVar' && (!r.returnVar.fn || !r.returnVar.via)) throw new Error('a returnVar route needs both fn and via');
    const s =
      kind === 'inline'
        ? inlineShape(dspText, r.inline, pre)
        : kind === 'guarded'
          ? guardedShape(dspText, r.guarded, pre)
          : kind === 'builtBy'
            ? nestedShapes(dspText, r.builtBy)
            : returnVarShape(dspText, r.returnVar.fn, r.returnVar.via, pre);
    if (!s) return { failed: `${kind} \`${names}\`` };
    const keys = (s.union || s.keys || []).slice().sort();
    if (!keys.length) return { failed: `${kind} \`${names}\`` };
    if (s.partialKind === 'undefined-value') for (const k of s.partial || []) undefPartial.add(k);
    got.push({ at: s.at ?? (s.shapes && s.shapes[0] ? s.shapes[0].at : null), keys, via: kind, name: names });
  }
  const union = [...new Set(got.flatMap((r) => r.keys))].sort();
  const routeMissing = union.filter((k) => !got.every((r) => r.keys.includes(k)));
  const canBeUndefined = union.filter((k) => undefPartial.has(k));
  if (routeMissing.length && canBeUndefined.length)
    throw new Error(
      `subtree routes carry keys conditional for TWO different reasons — ${routeMissing.join(', ')} absent from one route and ${canBeUndefined.join(', ')} able to evaluate to \`undefined\` — and one \`partialKind\` cannot state both`
    );
  return {
    shapes: got.map((r) => ({ at: r.at, keys: r.keys })),
    routes: got,
    union,
    keys: union,
    at: got[0].at,
    partial: routeMissing.length ? routeMissing : canBeUndefined,
    partialKind: routeMissing.length ? 'export-route' : 'undefined-value',
    shapeKind: 'routes'
  };
}

function enclosingFn(cl, i) {
  for (let j = i; j >= 0; j--) {
    if (!/function\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{\s*$/.test(cl[j]) && !/function\s*\([^)]*\)\s*\{\s*$/.test(cl[j])) continue;
    let d = 0;
    for (let k = j; k < cl.length; k++) {
      d += (cl[k].match(/\{/g) || []).length - (cl[k].match(/\}/g) || []).length;
      if (k > j && d <= 0) {
        if (k >= i) return [j, k];
        break;
      }
    }
  }
  return null;
}

/* 🔴 A SHADOWED ALIAS CREDITS THE WRONG OBJECT, so a scope that rebinds its alias is REFUSED rather
   than read. `a` is the commonest identifier in a render file: a comparator parameter or a second
   assignment inside the same function would make `a.total` a read of something else entirely. This
   is the escaper-shadowing shape of `tools/xss-sink-gate.mjs`, one file over. */
export function aliasSites(renderText, path) {
  const { code, by } = prepare(renderText);
  const cl = code.split('\n');
  /* A GUARD IN FRONT OF THE PATH IS STILL A BINDING: `var cs = FUSION && FUSION.clockSkew`.
     The guard makes the alias possibly falsy, which a reader handles, and it does not change WHICH
     object the alias names.

     🔴 BUT A MEMBER ACCESS AFTER THE PATH DOES CHANGE IT, AND A LOOKAHEAD CANNOT CATCH IT. The
     old form barred an identifier character after the path and allowed a `.`, so with the path
     `FUSION` the same line bound `cs` as an alias of FUSION itself. `cs` names `FUSION.clockSkew`,
     one level down, and the gate then credited a read of `cs.findings` — the clockSkew subtree's
     own findings array, whose element carries 8 different keys — against the TOP-LEVEL `findings`
     array. Measured 2026-11-13 while declaring that array: 1 of its 8 element read sites was this
     false credit.

     Barring the `.` is not enough either, and this is the part worth reading twice. The guard group
     is OPTIONAL, so with zero guards the path matches the GUARD's own occurrence of `FUSION` and
     the character after it is a space, which any lookahead of that kind allows. So the binding must
     END at the path: after it the line may carry a `||` fallback and then it must close. A ternary
     or a further member access is NOT a binding of this path, and the gate now declines to read
     one rather than crediting the wrong object. */
  const bind = new RegExp('\\b([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(?:[A-Za-z_$][A-Za-z0-9_$.]*\\s*&&\\s*)*' + escapeRe(path) + '\\s*(?:\\|\\|[^;,)\\]}]*)?(?=[;,)\\]}]|$)');
  const sites = [];
  const unresolved = [];
  cl.forEach((l, i) => {
    const m = l.match(bind);
    if (!m) return;
    const scope = enclosingFn(cl, i);
    if (!scope) {
      unresolved.push(i + 1);
      return;
    }
    const alias = m[1];
    const shadows = [];
    /* An ASSIGNMENT to the alias that is not this binding, or the alias as a PARAMETER. The
       parameter test reads only the two forms that bind one: `function …(…)` and `(…) =>`. An
       `if (a) {` is neither, and a test that cannot tell it from a parameter list reports every
       site shadowed and credits nothing — measured on this very subtree while writing this. */
    shadows.push(...shadowScan(cl, alias, scope[0], scope[1], (line) => bind.test(line)));
    sites.push({ line: i + 1, alias, from: scope[0], to: scope[1], shadows });
  });
  return { sites, unresolved, blankedBy: by };
}

/* 🔴 NAME THE REALM ONLY WHEN TWO OF THEM BIND. A one-realm subtree keeps the exact line it
   printed before this change, so the four earlier subtrees' evidence is comparable across the
   change; a second realm turns `w@415` into `w@integrator-render.js:415`, which is the only form
   that tells two bindings of the same alias name apart. */
/** `alias@line` per anchored site, file-qualified when more than one realm binds. */
export function aliasLabel(sites) {
  const multi = new Set(sites.map((s) => s.file)).size > 1;
  return sites.map((s) => s.alias + '@' + (multi ? s.file + ':' : '') + s.line).join(', ') || 'none';
}

/** The same qualification for a one-hop forward, which carries its callee too. */
export function forwardLabel(sites) {
  const multi = new Set(sites.map((s) => s.file)).size > 1;
  return sites.map((f) => f.via + '(' + f.alias + ')@' + (multi ? f.file + ':' : '') + f.line).join(', ');
}

/** Lines in a scope that REBIND the alias, or bind it as a parameter. `skip` exempts the binding. */
function shadowScan(cl, alias, from, to, skip) {
  const out = [];
  const rebind = new RegExp('\\b' + escapeRe(alias) + '\\s*=(?![=>])');
  const tok = new RegExp('(^|[,(\\s])' + escapeRe(alias) + '($|[,)\\s=])');
  for (let j = from; j <= to; j++) {
    const line = cl[j] || '';
    if (skip(line, j)) continue;
    if (rebind.test(line)) {
      out.push(j + 1);
      continue;
    }
    const params = [];
    for (const m of line.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) params.push(m[1]);
    for (const m of line.matchAll(/\(([^)]*)\)\s*=>/g)) params.push(m[1]);
    for (const m of line.matchAll(/(^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g)) params.push(m[2]);
    if (params.some((ps) => tok.test(ps))) out.push(j + 1);
  }
  return out;
}

/* 🔴 A SUBTREE HANDED TO A HELPER IS STILL A READ OF THAT SUBTREE. `integrator-app.js` binds
   `var cs = FUSION && FUSION.clockSkew` and then calls `skewSilenceLines(cs)`, which reads
   `vetoes` and `seamCensus` one scope away. Without this hop those two keys read as unrendered
   and the gate would convict correct code.

   ONE HOP, AND THE GATE REFUSES THE REST: a helper whose name resolves to no declaration or to
   more than one, a parameter list that is not exactly one plain identifier, a head this scanner
   cannot brace-match, or a hop out of a hop. A second hop makes the credit unbounded, and an
   unbounded credit is how a declaration stops meaning anything. */
export function forwardedSites(cl, sites) {
  const out = [];
  const seen = new Set();
  for (const s of sites) {
    const call = new RegExp('\\b([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(\\s*' + escapeRe(s.alias) + '\\s*\\)');
    for (let j = s.from; j <= s.to; j++) {
      const m = (cl[j] || '').match(call);
      if (!m) continue;
      const head = new RegExp('function\\s+' + escapeRe(m[1]) + '\\s*\\(([^)]*)\\)\\s*\\{\\s*$');
      const hits = [];
      cl.forEach((l, i) => {
        if (head.test(l)) hits.push(i);
      });
      if (hits.length !== 1) continue;
      const at = hits[0];
      const params = (cl[at].match(head)[1] || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (params.length !== 1 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(params[0])) continue;
      const scope = enclosingFn(cl, at + 1);
      if (!scope || scope[0] !== at || seen.has(at)) continue;
      seen.add(at);
      out.push({
        line: at + 1,
        alias: params[0],
        via: m[1],
        from: scope[0],
        to: scope[1],
        hopFrom: s.line,
        shadows: shadowScan(cl, params[0], scope[0], scope[1], (_l, k) => k === at)
      });
    }
  }
  return out;
}

/** Is `key` read through one of these alias sites, inside that site's own scope. */
export function readsNested(renderText, sites, key, blanked) {
  const cl = (blanked || prepare(renderText)).code.split('\n');
  const raw = renderText.split('\n');
  for (const s of sites) {
    const dot = new RegExp('\\b' + escapeRe(s.alias) + '\\s*\\.\\s*' + escapeRe(key) + '(?![A-Za-z0-9_$])');
    const br = new RegExp('\\b' + escapeRe(s.alias) + '\\s*\\[\\s*([\'"])' + escapeRe(key) + '\\1\\s*\\]');
    for (let j = s.from; j <= s.to; j++) if (dot.test(cl[j] || '') || br.test(raw[j] || '')) return true;
  }
  return false;
}

/* 🔴 A READER NEED NOT BIND AN ALIAS. `overdex-app.js:862` reads `fusion.kernelAudit.ok` through
   the WHOLE path, so `aliasSites` finds nothing to credit and an alias-only test calls that key
   unread. A direct path read needs no scope, because the path names the object at the read site. */
export function readsDirectPath(text, path, key) {
  const { code } = prepare(text);
  const dot = new RegExp('\\b' + escapeRe(path) + '\\s*\\.\\s*' + escapeRe(key) + '(?![A-Za-z0-9_$])');
  const br = new RegExp('\\b' + escapeRe(path) + '\\s*\\[\\s*([\'"])' + escapeRe(key) + '\\1\\s*\\]');
  return dot.test(code) || br.test(text);
}

/* 🔴 A MEMBER CHAIN SPLIT ACROSS LINES DEFEATS A PER-LINE REGEX. `overdex-app.js` writes
   `fusion.kernelAudit.mismatches` on one line and `.map(function (m) {` on the next, so a
   line-by-line scan found 2 of the 3 element-read sites in this repo and reported the third as
   absent. Every test here runs over the WHOLE blanked text, where `\s` spans a newline. */

/* The iterators whose callback binds ONE element of the array, and the calls that may sit between
   the array and such an iterator. `filter`, `sort`, `slice` and `reverse` hand on the SAME
   elements, so the walk below crosses them; `map`, `flatMap` and `reduce` change what a callback
   receives and `some`/`every`/`find` do not return an array, so the walk stops at those. */
const ELEM_ITERATORS = ['map', 'forEach', 'filter', 'flatMap', 'some', 'every', 'find', 'reduce'];
const CHAIN_SAFE = ['slice', 'filter', 'sort', 'reverse'];

/* 🔴 A TOP-LEVEL EXPORT ARRAY IS NOT READ THE WAY A SUBTREE'S ARRAY IS, AND THE ADJACENT ANCHOR SAW
   ONE SITE IN FIVE. A subtree's array is read as `fusion.kernelAudit.mismatches.map(`, with the
   iterator adjacent to the member, so the first anchor required adjacency. A top-level export key
   is read DEFENSIVELY instead: three of the five `fusion.findings` sites wrap the member as
   `(fusion.findings || [])` and one chains `.slice(0, 12)` before `.forEach`. Measured 2026-11-13,
   the adjacent anchor credited 2 of the 11 findings keys and 6 card keys had no reader.

   So the anchor became a WALK. It takes the member, then an optional `|| []` or `?? []` default
   guard, then any number of element-preserving calls, and it stops at the first thing it does not
   recognise rather than guessing past it. Measured on all seven already-declared element arrays:
   the walk finds exactly the sites the anchor found, so the generalisation is additive. */
function callbackSites(code, prefixes, arrayKey) {
  const alt = prefixes.filter(Boolean).map(escapeRe).join('|');
  if (!alt) return [];
  const re = new RegExp('(' + alt + ')\\s*\\.\\s*' + escapeRe(arrayKey) + '(?![A-Za-z0-9_$])', 'g');
  const out = [];
  let m;
  while ((m = re.exec(code))) {
    let p = m.index + m[0].length;
    const skip = () => {
      while (p < code.length && /\s/.test(code[p])) p++;
    };
    skip();
    /* The default guard. `(fusion.findings || [])` reads the same array as `fusion.findings`, so
       the walk crosses it and records that it did. A guard over anything but an empty array
       literal is NOT this form and stops the walk. */
    let guarded = false;
    const g = /^(?:\|\||\?\?)\s*\[\s*\]\s*\)/.exec(code.slice(p));
    if (g) {
      p += g[0].length;
      guarded = true;
    }
    const chain = [];
    for (;;) {
      skip();
      const c = /^\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(code.slice(p));
      if (!c) break;
      const name = c[1];
      const callOpen = p + c[0].length - 1;
      let d = 0;
      let close = -1;
      for (let j = callOpen; j < code.length; j++) {
        if (code[j] === '(') d++;
        else if (code[j] === ')') {
          d--;
          if (d === 0) {
            close = j;
            break;
          }
        }
      }
      /* An unbalanced call is not a site this reader can scope, so it is skipped WITH a count. */
      if (close < 0) break;
      if (ELEM_ITERATORS.includes(name)) {
        const head = code.slice(callOpen + 1, callOpen + 80);
        const pm = head.match(/^\s*(?:function\s*[A-Za-z0-9_$]*\s*)?\(?\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (pm)
          out.push({
            prefix: m[1],
            iterator: name,
            param: pm[1],
            from: callOpen,
            to: close,
            line: code.slice(0, callOpen).split('\n').length,
            guarded,
            chain: chain.slice()
          });
        /* 🔴 AN ITERATOR CAN ALSO BE A LINK. `findings.filter(...).forEach(...)` holds TWO element
           read sites, and stopping at the first would lose the second. Only the iterators that
           hand on the same elements may be crossed. */
        if (!CHAIN_SAFE.includes(name)) break;
        chain.push(name);
        p = close + 1;
        continue;
      }
      if (!CHAIN_SAFE.includes(name)) break;
      chain.push(name);
      p = close + 1;
    }
  }
  return out;
}

/** Element read sites, paired across the two texts. The dot form reads the BLANKED body, so a
    commented-out read cannot credit a key; the bracket form needs the RAW body, because blanking
    takes the key name out of `m['status']`. The two texts share no offset under the tokenizer
    route (see `elementShape`), so pair them by ORDER and refuse to pair at all when the counts
    disagree — a comment or a string naming the same chain IS that disagreement. */
export function elementCallbacks(text, prefixes, arrayKey, pre = prepare) {
  const blanked = callbackSites(pre(text).code, prefixes, arrayKey);
  const raw = callbackSites(text, prefixes, arrayKey);
  const paired = raw.length === blanked.length;
  return blanked.map((s, i) =>
    Object.assign({}, s, {
      rawFrom: paired ? raw[i].from : null,
      rawTo: paired ? raw[i].to : null,
      rawLine: paired ? raw[i].line : null
    })
  );
}

/* Is `elemKey` read off the element parameter of one of these callbacks.

   🔴 THE BRACKET FORM MUST BE READ ON RAW TEXT. `prepare` blanks every string literal, so
   `m['status']` in blanked code carries no key name and an element read that OverDex writes in
   bracket form would read as absent. Depth 1 and depth 2 already split the two tests this way;
   depth 3 owed the same split, and a fixture caught it before a declaration relied on it.
   Blanking preserves length, so one offset pair indexes both texts. */
export function readsElementKey(text, sites, elemKey, pre = prepare) {
  const { code } = pre(text);
  for (const s of sites) {
    const body = code.slice(s.from, s.to + 1);
    /* An unpaired site has no raw body to read, so the bracket form falls back to the blanked body,
       where a quoted key reads as absent. `elemRawUnpaired` reports that, and the gate reds. */
    const rawBody = s.rawFrom === null ? body : text.slice(s.rawFrom, s.rawTo + 1);
    const dot = new RegExp('\\b' + escapeRe(s.param) + '\\s*\\.\\s*' + escapeRe(elemKey) + '(?![A-Za-z0-9_$])');
    const br = new RegExp('\\b' + escapeRe(s.param) + '\\s*\\[\\s*([\'"])' + escapeRe(elemKey) + '\\1\\s*\\]');
    if (dot.test(body) || br.test(rawBody)) return s;
  }
  return null;
}

/** The same red conditions as depth 1, plus the undeclared partial shape, for ONE subtree. */
export function evaluateNested(subtree, shapes, decl, renderText, extra) {
  const path = (decl && decl.aliasPath) || 'fusion.' + subtree;
  /* ONE reader file was the assumption here too. A subtree may be read in several declared realms,
     each with its own holder — `FUSION.kernelAudit` in the app, `fusion.kernelAudit` in OverDex. The
     3-argument call keeps its single realm, so every earlier caller reads the same. */
  const given = (extra && extra.readers) || null;
  const readers = (given && given.length ? given : [{ file: (decl && decl.readerFile) || 'integrator-render.js', text: renderText }]).map((r) => {
    const ap = r.aliasPath || path;
    const bl = prepare(r.text);
    const f = aliasSites(r.text, ap);
    const dir = f.sites.filter((x) => !x.shadows.length);
    const fw = forwardedSites(bl.code.split('\n'), dir);
    return { file: r.file, aliasPath: ap, text: r.text, blanked: bl, found: f, forwarded: fw, usable: dir.concat(fw.filter((x) => !x.shadows.length)) };
  });
  const first = readers[0];
  /* `found` survives for `blankedBy` ALONE — the parse route is realm-independent. Every
     per-site field below walks `readers`, because the first realm is not the evidence. */
  const found = first.found;
  const surfaces = (decl && decl.surfaces) || {};
  const declaredPartial = (decl && decl.partialShape) || {};
  const union = shapes.union;
  const creditedBy = (k) => readers.find((r) => readsNested(r.text, r.usable, k, r.blanked) || readsDirectPath(r.text, r.aliasPath, k)) || null;
  const read = (k) => !!creditedBy(k);
  const undeclared = union.filter((k) => !surfaces[k]);
  const badValue = union.filter((k) => surfaces[k] && !SURFACES.includes(surfaces[k]));
  const cardUnrendered = union.filter((k) => surfaces[k] === 'card' && !read(k));
  const exportOnlyRead = union.filter((k) => surfaces[k] === 'export-only' && read(k));
  const stale = Object.keys(surfaces).filter((k) => !union.includes(k));
  const undeclaredPartial = shapes.partial.filter((k) => !declaredPartial[k]);
  const stalePartial = Object.keys(declaredPartial).filter((k) => !shapes.partial.includes(k));
  /* 🔴 A BINDING IS OWED ONLY WHERE A READ MUST BE CREDITED. `fusion.clockSkew` reaches no `card`
     key in `integrator-render.js`, and a subtree whose every key is `export-only` has nothing to
     credit — demanding an alias there would red correct code for carrying no reader surface. */
  const cardDeclared = union.filter((k) => surfaces[k] === 'card');
  const noAlias = cardDeclared.length > 0 && readers.every((r) => !r.usable.length) && !cardDeclared.some((k) => readers.some((r) => readsDirectPath(r.text, r.aliasPath, k)));
  const cardByReader = {};
  for (const r of readers) cardByReader[r.file] = cardDeclared.filter((k) => (creditedBy(k) || {}).file === r.file).length;
  /* 🔴 DEPTH 3 — WHAT A READER TAKES OUT OF AN ELEMENT. `kernelAudit.mismatches` is declared `card`
     and that says only "a reader touches the array". `integrator-app.js` reads `m.node` and
     `m.hash` off each element and `overdex-app.js` reads `m.status`, while `version` reaches no
     reader at all. Until today the gate judged the parent and saw nothing of the four keys inside
     it. The element layer is OPT-IN: a subtree with no `elements` block is judged exactly as before. */
  const elemDecl = (decl && decl.elements) || null;
  const elemShapes = (extra && extra.elementShapes) || {};
  const elements = [];
  const elemShapeMissing = [];
  const elemUndeclared = [];
  const elemBadValue = [];
  const elemCardUnread = [];
  const elemExportOnlyRead = [];
  const sitesFor = (r, keys) => {
    const prefixes = [r.aliasPath].concat(r.usable.map((s) => s.alias));
    const all = keys.flatMap((k) =>
      elementCallbacks(r.text, prefixes, k)
        .concat(indexedElements(r.text, prefixes, k))
        .map((s) => Object.assign({ arrayKey: k }, s))
    );
    /* An ALIAS prefix is credited only inside that alias's own scope, exactly as a depth-2 read is.
       The whole path needs no scope, because the path names the object at the site. */
    return all.filter((s) => s.prefix === r.aliasPath || r.usable.some((u) => u.alias === s.prefix && s.line >= u.from + 1 && s.line <= u.to + 1));
  };
  const servedKeys = [];
  const elemServesUnknown = [];
  const elemRawUnpaired = [];
  if (elemDecl) {
    for (const vn of Object.keys(elemDecl)) {
      const ed = elemDecl[vn] || {};
      /* 🔴 A `servesKeys` ENTRY THE SUBTREE DOES NOT CARRY MUST NAME ITSELF. Dropping it silently
         left every element key unread, and the gate then blamed the four keys instead of the one
         stale array name that caused it. Measured as control Q on 2026-11-12. */
      for (const k of ed.servesKeys || []) if (!union.includes(k)) elemServesUnknown.push(vn + ' serves ' + k);
      const serves = (ed.servesKeys || []).filter((k) => union.includes(k));
      for (const k of serves) servedKeys.push(k);
      const shp = elemShapes[vn];
      if (!shp) {
        elemShapeMissing.push(vn);
        elements.push({ name: vn, serves, keys: [], readable: false, cardByReader: {} });
        continue;
      }
      const esurf = ed.surfaces || {};
      const byReader = readers.map((r) => ({ reader: r, sites: sitesFor(r, serves) }));
      /* 🔴 A SITE THE TWO TEXTS DISAGREE ON CANNOT BE READ IN BRACKET FORM, so it is named here and
         it reds. The blanked body and the raw body pair by order only while both texts hold the
         same number of sites. */
      for (const x of byReader) for (const st of x.sites) if (st.rawFrom === null) elemRawUnpaired.push(x.reader.file + ':' + st.line + ' (' + st.arrayKey + ')');
      const elemCreditedBy = (k) => byReader.find((x) => readsElementKey(x.reader.text, x.sites, k)) || null;
      for (const k of shp.keys) {
        if (!(k in esurf)) {
          elemUndeclared.push(vn + '.' + k);
          continue;
        }
        if (esurf[k] !== 'card' && esurf[k] !== 'export-only') {
          elemBadValue.push(vn + '.' + k);
          continue;
        }
        const hit = elemCreditedBy(k);
        if (esurf[k] === 'card' && !hit) elemCardUnread.push(vn + '.' + k);
        if (esurf[k] === 'export-only' && hit) elemExportOnlyRead.push(vn + '.' + k);
      }
      const stale = Object.keys(esurf).filter((k) => !shp.keys.includes(k));
      for (const k of stale) elemUndeclared.push(vn + '.' + k + ' (declared, absent from the literal)');
      const ecard = {};
      for (const x of byReader) ecard[x.reader.file] = shp.keys.filter((k) => esurf[k] === 'card' && (elemCreditedBy(k) || {}).reader === x.reader).length;
      elements.push({
        name: vn,
        at: shp.at,
        serves,
        keys: shp.keys,
        /* A union over push sites carries keys that only SOME site writes. The parent subtree
           already says `partial` for the same state one level up, and the word keeps its meaning:
           the key can be absent from the object a reader holds. */
        partial: shp.partial || [],
        siteAt: shp.siteAt || [],
        buildSites: shp.sites || [],
        readable: true,
        sites: byReader.flatMap((x) => x.sites.map((s) => ({ file: x.reader.file, line: s.rawLine === null ? s.line : s.rawLine, arrayKey: s.arrayKey, iterator: s.iterator, param: s.param }))),
        cardByReader: ecard
      });
    }
  }
  /* 🔴 A SKIP WITH A STATED REASON IS NOT A BLINDNESS, AND THIS ONE IS COUNTED. `clockSkew.findings`
     is read element-wise at `integrator-app.js:90` and no element shape declares it, so the gate
     says how many such sites it chose not to judge rather than passing in silence. It is a census
     and not a red: seeding a declaration nobody hand-read is the defect section 4 of the brief
     records, and the count drops to 0 when a later unit reads that literal. */
  const elemUnjudged = [];
  for (const r of readers) {
    const open = union.filter((k) => !servedKeys.includes(k));
    const bound = new Set();
    for (const s of sitesFor(r, open)) {
      bound.add(s.arrayKey);
      elemUnjudged.push(
        Object.assign(
          { file: r.file, line: s.rawLine === null ? s.line : s.rawLine, arrayKey: s.arrayKey, param: s.param, prefix: s.prefix, holder: r.aliasPath },
          s.iterator === 'index' ? { via: 'index' } : {}
        )
      );
    }
    /* 🔴 AND THE INDEXED FORM, which `callbackSites` cannot see (see `indexedSites`). It is scoped
       exactly as a callback site is: the whole path needs no scope, an alias is credited only
       inside its own binding. */
    const iprefixes = [r.aliasPath].concat(r.usable.map((u) => u.alias));
    for (const k of open) {
      /* 🔴 ONE READ, COUNTED ONCE. `sitesFor` above now finds the indexed form whose element is
         BOUND to a variable, so this scan is for the array-level form alone — `ns[i].node` read
         with no binding at all, which no reader can judge and the census still must state. */
      if (bound.has(k)) continue;
      for (const s of indexedSites(r.text, iprefixes, k)) {
        if (!(s.prefix === r.aliasPath || r.usable.some((u) => u.alias === s.prefix && s.line >= u.from + 1 && s.line <= u.to + 1))) continue;
        elemUnjudged.push({
          file: r.file,
          line: s.rawElemLine === null ? s.elemLine : s.rawElemLine,
          arrayKey: k,
          param: s.param,
          prefix: s.prefix,
          holder: r.aliasPath,
          via: 'index'
        });
      }
    }
  }
  /* 🔴 A `card` LABEL CANNOT BE HONEST AT THIS DEPTH. The read machinery credits a key one hop
     below an alias, and nothing in it addresses `holder.schema.method.window`. So an inner key
     declares `export-only`, and a `card` there names itself rather than let the gate report a
     credit it never computed. Stale is REPORTED and not red, exactly as depth 1 and depth 2 treat
     a declaration the literal no longer carries: the author owns the removal. */
  const innerDecl = (decl && decl.inner) || null;
  const innerShapes = (extra && extra.innerShapes) || {};
  const inners = [];
  const innerShapeMissing = [];
  const innerUnknown = [];
  const innerUndeclared = [];
  const innerBadValue = [];
  const innerCardDeclared = [];
  const innerStale = [];
  if (innerDecl) {
    for (const vn of Object.keys(innerDecl)) {
      const id = innerDecl[vn] || {};
      /* An inner literal the parent does not carry is the `elemServesUnknown` lesson one layer
         over: a stale parent key leaves every inner key unjudged, and the gate must blame the one
         name that caused it. */
      if (!union.includes(vn)) innerUnknown.push(vn);
      const shp = innerShapes[vn];
      if (!shp) {
        innerShapeMissing.push(vn);
        inners.push({ name: vn, keys: [], readable: false });
        continue;
      }
      const isurf = id.surfaces || {};
      for (const k of shp.keys) {
        if (!(k in isurf)) {
          innerUndeclared.push(vn + '.' + k);
          continue;
        }
        if (isurf[k] === 'card') {
          innerCardDeclared.push(vn + '.' + k);
          continue;
        }
        if (isurf[k] !== 'export-only') innerBadValue.push(vn + '.' + k);
      }
      for (const k of Object.keys(isurf)) if (!shp.keys.includes(k)) innerStale.push(vn + '.' + k);
      inners.push({ name: vn, at: shp.at, keys: shp.keys, partial: shp.partial || [], partialKind: shp.partialKind, readable: true });
    }
  }
  return {
    subtree,
    path,
    keys: union,
    shapes: shapes.shapes.map((s) => ({ at: s.at, keys: s.keys.length })),
    partial: shapes.partial,
    partialKind: shapes.partialKind || 'return-shape',
    shapeKind: shapes.shapeKind || null,
    readerFile: first.file,
    readerFiles: readers.map((r) => r.file),
    readerHolders: readers.map((r) => r.aliasPath),
    cardByReader,
    cardUnrenderedWhere: readers.map((r) => r.file).join(' + '),
    /* 🔴 EVERY REALM'S SITES, NOT THE FIRST REALM'S. These three read `first.found` until now, so a
       subtree read in several realms put ONE realm's bindings in the verdict while the credit loop
       above already walked each reader's own `usable`. `fusion.window` binds `w` at
       integrator-render.js:415 and again at overdex-app.js:717, and the evidence line named one of
       the two. Nothing reded, because no judgement reads these fields — that is the shape of defect
       a reader hides best: the gate is right and the number a person checks is wrong. The four
       earlier subtrees never showed it, because their second realm reads the whole path and binds
       no alias (`K2` in the selftests is exactly that case). Each site now carries its file. */
    aliasSites: readers.flatMap((r) => r.found.sites.map((s) => ({ file: r.file, line: s.line, alias: s.alias, shadows: s.shadows }))),
    forwarded: readers.flatMap((r) => r.forwarded.map((f) => ({ file: r.file, line: f.line, alias: f.alias, via: f.via, hopFrom: f.hopFrom, shadows: f.shadows }))),
    aliasUnresolved: readers.flatMap((r) => r.found.unresolved.map((line) => ({ file: r.file, line }))),
    noAlias,
    undeclared,
    badValue,
    cardUnrendered,
    exportOnlyRead,
    stale,
    undeclaredPartial,
    stalePartial,
    blankedBy: found.blankedBy,
    elements,
    elemShapeMissing,
    elemUndeclared,
    elemBadValue,
    elemCardUnread,
    elemExportOnlyRead,
    elemUnjudged,
    elemServesUnknown,
    elemRawUnpaired,
    inners,
    innerShapeMissing,
    innerUnknown,
    innerUndeclared,
    innerBadValue,
    innerCardDeclared,
    innerStale,
    ok:
      !noAlias &&
      !undeclared.length &&
      !badValue.length &&
      !cardUnrendered.length &&
      !exportOnlyRead.length &&
      !undeclaredPartial.length &&
      !stalePartial.length &&
      !elemShapeMissing.length &&
      !elemServesUnknown.length &&
      !elemRawUnpaired.length &&
      !elemUndeclared.length &&
      !elemBadValue.length &&
      !elemCardUnread.length &&
      !elemExportOnlyRead.length &&
      !innerShapeMissing.length &&
      !innerUnknown.length &&
      !innerUndeclared.length &&
      !innerBadValue.length &&
      !innerCardDeclared.length
  };
}

/** The reasons, in the order a reader needs them. Empty when the subtree is clean. */
export function nestedReasons(n) {
  return [
    n.noAlias
      ? `no usable binding of \`${n.path}\` survives in ${n.cardUnrenderedWhere || n.readerFile}, and no read goes through the whole path — every alias site is shadowed or unscoped, so no nested read can be credited`
      : '',
    n.undeclared.length ? `${n.undeclared.length} nested key(s) of \`${n.path}\` declare no surface: ${n.undeclared.join(', ')}` : '',
    n.badValue.length ? `${n.badValue.length} nested key(s) declare something other than 'card' or 'export-only': ${n.badValue.join(', ')}` : '',
    n.cardUnrendered.length
      ? `${n.cardUnrendered.length} nested key(s) declare 'card' and no anchored read reaches them in ${n.cardUnrenderedWhere || n.readerFile}: ${n.cardUnrendered.join(', ')}`
      : '',
    n.exportOnlyRead.length ? `${n.exportOnlyRead.length} nested key(s) declare 'export-only' and an anchored read reaches them: ${n.exportOnlyRead.join(', ')}` : '',
    n.undeclaredPartial.length
      ? `${n.undeclaredPartial.length} nested key(s) ${n.partialKind === 'undefined-value' ? 'can evaluate to `undefined` and leave the export' : n.partialKind === 'export-route' ? 'exist on one export route only' : 'exist on some return shapes only'}, with no partialShape reason declared: ${n.undeclaredPartial.join(', ')}`
      : '',
    n.stalePartial.length ? `${n.stalePartial.length} partialShape declaration(s) name a key whose presence is no longer conditional: ${n.stalePartial.join(', ')}` : '',
    (n.elemShapeMissing || []).length ? `${n.elemShapeMissing.length} element shape(s) are declared and this gate could not read the literal from source: ${n.elemShapeMissing.join(', ')}` : '',
    (n.elemServesUnknown || []).length ? `${n.elemServesUnknown.length} element shape(s) serve an array key this subtree does not carry: ${n.elemServesUnknown.join(', ')}` : '',
    (n.elemRawUnpaired || []).length
      ? `${n.elemRawUnpaired.length} element read site(s) do not pair across the blanked and raw text, so a bracket read cannot be judged there: ${n.elemRawUnpaired.join(', ')}`
      : '',
    (n.elemUndeclared || []).length ? `${n.elemUndeclared.length} element key(s) declare no surface: ${n.elemUndeclared.join(', ')}` : '',
    (n.elemBadValue || []).length ? `${n.elemBadValue.length} element key(s) declare something other than 'card' or 'export-only': ${n.elemBadValue.join(', ')}` : '',
    (n.elemCardUnread || []).length
      ? `${n.elemCardUnread.length} element key(s) declare 'card' and no anchored element read reaches them in ${n.cardUnrenderedWhere || n.readerFile}: ${n.elemCardUnread.join(', ')}`
      : '',
    (n.elemExportOnlyRead || []).length ? `${n.elemExportOnlyRead.length} element key(s) declare 'export-only' and an anchored element read reaches them: ${n.elemExportOnlyRead.join(', ')}` : '',
    (n.innerShapeMissing || []).length ? `${n.innerShapeMissing.length} inner literal(s) are declared and this gate could not read them from source: ${n.innerShapeMissing.join(', ')}` : '',
    (n.innerUnknown || []).length ? `${n.innerUnknown.length} inner literal(s) name a key this subtree does not carry: ${n.innerUnknown.join(', ')}` : '',
    (n.innerUndeclared || []).length ? `${n.innerUndeclared.length} inner key(s) declare no surface: ${n.innerUndeclared.join(', ')}` : '',
    (n.innerBadValue || []).length ? `${n.innerBadValue.length} inner key(s) declare something other than 'export-only': ${n.innerBadValue.join(', ')}` : '',
    (n.innerCardDeclared || []).length
      ? `${n.innerCardDeclared.length} inner key(s) declare 'card', and this gate credits no reader one level inside a subtree, so the label states a credit nobody computed: ${n.innerCardDeclared.join(', ')}`
      : ''
  ].filter(Boolean);
}

/** The three red conditions, and nothing else. */
export const DEFAULT_REALM = 'integrator-render.js';

/* 🔴 ONE REALM WAS AN ASSUMPTION, NOT A CONTRACT. `export-only` reads "carried on the node-export
   and deliberately not rendered", and until today the gate checked that claim against ONE file.
   Measured 2026-11-12 over the 36 top-level keys: `clockSkew` and `kernelAudit` are both declared
   `export-only`, `integrator-render.js` names neither, and `integrator-app.js` binds both
   (`:77`, `:88`) and pushes reader-facing banner lines from each. So two of the 36 cells said
   "deliberately not rendered" about values a reader meets on every fusion.

   A realm is DECLARED (`readerRealms`), never discovered, and the verdict names the set. A
   non-default realm declares the holder its reads must anchor on, and a card key names the one
   realm that must read it (`readerFiles`, default the render file). An `export-only` key must be
   read in NO declared realm. */
export function realmsFrom(renderText, decl, load) {
  const declared = decl && decl.readerRealms;
  if (!declared) return [{ file: DEFAULT_REALM, raw: renderText, isDefault: true, holder: null }];
  const out = [];
  for (const [file, d] of Object.entries(declared)) {
    const isDefault = file === DEFAULT_REALM;
    if (!isDefault && !(d && d.holder)) throw new Error(`reader realm \`${file}\` declares no holder — an unanchored read in a second realm is not evidence`);
    out.push({ file, raw: isDefault ? renderText : load(file), isDefault, holder: isDefault ? null : d.holder });
  }
  if (!out.some((r) => r.isDefault)) throw new Error(`readerRealms omits ${DEFAULT_REALM} — the render realm is the contract's default and the gate must not drop it`);
  return out;
}

export function evaluate(keys, surfaces, renderText, extra) {
  const realms = (extra && extra.realms) || [{ file: DEFAULT_REALM, raw: renderText, isDefault: true, holder: null }];
  const readerFiles = (extra && extra.readerFiles) || {};
  let by = null;
  for (const r of realms) {
    const p = prepare(r.raw);
    r.code = p.code;
    if (r.isDefault) by = p.by;
  }
  /* A reader file nobody declared is a DEFECT IN THE DECLARATION, reported the way an unknown
     surface value is, and not a crash: the gate can say exactly what is wrong. Those keys are then
     left out of the surface judgement, because there is no realm to judge them in. */
  const badRealm = Object.keys(readerFiles).filter((k) => !realms.some((r) => r.file === readerFiles[k]));
  const judged = keys.filter((k) => !badRealm.includes(k));
  const realmOf = (k) => realms.find((r) => r.file === (readerFiles[k] || DEFAULT_REALM));
  const readIn = (r, k) => (r.isDefault ? reads(r.code, r.raw, k) : readsAnchored(r.code, r.raw, r.holder, k));
  const undeclared = keys.filter((k) => !surfaces[k]);
  const badValue = keys.filter((k) => surfaces[k] && !SURFACES.includes(surfaces[k]));
  const cardUnrendered = judged.filter((k) => surfaces[k] === 'card' && !readIn(realmOf(k), k));
  /* The subset whose reason is PROSE and not absence — the state nothing could see until today.
     🔴 IN A SECOND REALM THAT SPLITS INTO TWO STATES, AND ONLY ONE OF THEM IS PROSE. A key the app
     mentions but never reads through the holder can be a COMMENT, or it can be live code reading a
     DIFFERENT object — `generated` and `schema` are both, in the same file. Calling that prose
     would send a reader to look for a comment that is not there, so a non-default realm reports
     `cardUnanchored` instead, and the repair it names is the holder, not the wording. */
  const cardProseOnly = cardUnrendered.filter((k) => realmOf(k).isDefault && mentions(realmOf(k).raw, k));
  const cardUnanchored = cardUnrendered.filter((k) => !realmOf(k).isDefault && mentions(realmOf(k).raw, k));
  const exportOnlyRead = judged.filter((k) => surfaces[k] === 'export-only' && realms.some((r) => r.isDefault && readIn(r, k)));
  /* The widening: the same claim, asked of every OTHER declared realm. Named separately because
     the repair differs — a render read means the declaration is wrong about rendering at all, and
     a second-realm read means it is wrong about WHICH file renders it. */
  const exportOnlyReadElsewhere = judged.filter((k) => surfaces[k] === 'export-only' && realms.some((r) => !r.isDefault && readIn(r, k)));
  const stale = Object.keys(surfaces).filter((k) => !keys.includes(k));
  return {
    undeclared,
    badValue,
    cardUnrendered,
    cardProseOnly,
    cardUnanchored,
    exportOnlyRead,
    exportOnlyReadElsewhere,
    badRealm,
    realms: realms.map((r) => r.file),
    cardUnrenderedByRealm: Object.fromEntries(realms.map((r) => [r.file, cardUnrendered.filter((k) => realmOf(k).file === r.file)]).filter(([, ks]) => ks.length)),
    cardByRealm: Object.fromEntries(realms.map((r) => [r.file, judged.filter((k) => surfaces[k] === 'card' && realmOf(k).file === r.file).length])),
    stale,
    blankedBy: by,
    ok: !undeclared.length && !badValue.length && !cardUnrendered.length && !exportOnlyRead.length && !exportOnlyReadElsewhere.length && !badRealm.length
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function main() {
  const dsp = readFileSync(join(ROOT, 'integrator-dsp.js'), 'utf8');
  if (!exportLiteralKeys(dsp)) throw new Error('the `var _exp = {` slim-export literal was not found, or it does not close — its shape changed, and this gate must not guess');
  const render = readFileSync(join(ROOT, 'integrator-render.js'), 'utf8');
  const decl = JSON.parse(readFileSync(DECL_PATH, 'utf8'));
  const keys = fusionKeys(dsp);
  /* The realms are loaded ONCE and shared with the nested pass, so a file read for a depth-1 card
     key is the same text a depth-2 subtree is judged against. */
  const realmFiles = new Map([[DEFAULT_REALM, render]]);
  const loadRealm = (f) => {
    if (!realmFiles.has(f)) realmFiles.set(f, readFileSync(join(ROOT, f), 'utf8'));
    return realmFiles.get(f);
  };
  /* 🔴 NO EAGER LOAD OF A DECLARED READER FILE. An earlier draft read every `readerFiles` value
     up front, so a key naming a file that does not exist died with ENOENT instead of reporting the
     declaration defect the gate is built to name. `realmsFrom` loads the declared realms, and a
     reader file outside that set is a `badRealm` finding. */
  const realms = realmsFrom(render, decl, loadRealm);
  const r = evaluate(keys, decl.surfaces || {}, render, { realms, readerFiles: decl.readerFiles || {} });

  /* THE NESTED SUBTREES, one entry at a time. A declared subtree whose builder shape has moved
     REFUSES — the same fail-closed rule the slim-export literal already carries above. */
  const nested = [];
  const readers = realmFiles;
  for (const [sub, d] of Object.entries(decl.nested || {})) {
    if (!d) throw new Error(`nested subtree \`${sub}\` declares nothing`);
    const byFn = !!d.builtBy;
    const byLiteral = d.inline === true;
    const byArray = d.arrayOf === true;
    const byRoutes = Array.isArray(d.routes) && d.routes.length > 0;
    /* 🔴 A THIRD SHAPE SOURCE, AND THE SAME REFUSAL TO GUESS. `arrayOf` says the subtree IS an
       ARRAY that the export projects, so it carries no keys of its own. Its one depth-2 key is the
       array name on the holder, and its depth-3 keys are the keys of ONE element. Exactly one
       source may be declared, because a subtree that declares two is a subtree the gate would have
       to choose for. */
    /* 🔴 A FOURTH SHAPE SOURCE: A LIST OF EXPORT ROUTES. One source form can read one route, and
       `apneaTyping` sits on two routes of DIFFERENT forms — the producer's own literal through a
       returned variable, and a guarded literal in the slim projection. `routes` names each one, the
       union is the surface, and a key absent from one route is partial. */
    const picked = [byFn && 'builtBy', byLiteral && 'inline:true', byArray && 'arrayOf:true', byRoutes && 'routes'].filter(Boolean);
    if (picked.length !== 1)
      throw new Error(
        `nested subtree \`${sub}\` must declare exactly one of builtBy, inline:true, arrayOf:true or routes — it declares ${picked.length ? picked.join(' and ') : 'none'}, and the gate must not guess where its shape lives`
      );
    const arrShape = byArray ? exportMapShape(dsp, d.exportMapped || sub) : null;
    if (byArray && !arrShape)
      throw new Error(
        `the export entry \`${d.exportMapped || sub}:\` with a single .map return literal was not found in integrator-dsp.js, appears more than once, or does not close — its shape changed, and this gate must not guess`
      );
    const shapes = byRoutes
      ? routeShapes(dsp, d.routes)
      : byFn
        ? nestedShapes(dsp, d.builtBy)
        : byArray
          ? { shapes: [{ at: arrShape.at, keys: [sub] }], union: [sub], partial: [], partialKind: 'export-array' }
          : inlineShape(dsp, sub);
    /* A route the reader could not read names ITSELF, because `routes` has several sources and a
       bare "the shape changed" would leave the author reading all of them. */
    if (shapes && shapes.failed)
      throw new Error(
        `nested subtree \`${sub}\` declares the route ${shapes.failed}, and that reader found no shape in integrator-dsp.js — the source moved, or the route's form changed, and this gate must not guess`
      );
    if (!shapes)
      throw new Error(
        byFn
          ? `${d.builtBy}() was not found, or one of its return objects does not close — its shape changed, and this gate must not guess`
          : `the inline \`${sub}: {\` literal in integrator-dsp.js was not found, appears more than once, or does not close — its shape changed, and this gate must not guess`
      );
    /* A subtree declares EITHER one `readerFile` or a `readerFiles` list of `{ file, aliasPath }`.
       Each file loads on first use, through the same map the depth-1 realms use, so one file is read
       once however many keys name it. A list entry with no `file` is a declaration defect. */
    const spec = Array.isArray(d.readerFiles) && d.readerFiles.length ? d.readerFiles : [{ file: d.readerFile || 'integrator-render.js' }];
    const rlist = spec.map((e) => {
      if (!e || !e.file) throw new Error(`nested subtree \`${sub}\` declares a reader with no file`);
      if (!readers.has(e.file)) readers.set(e.file, readFileSync(join(ROOT, e.file), 'utf8'));
      return { file: e.file, text: readers.get(e.file), aliasPath: e.aliasPath || null };
    });
    /* An element shape is read from the SAME source the parent shape came from. A declared shape
       this reader cannot read refuses here, beside the parent's refusal, rather than reporting an
       element surface it never saw. `inline` subtrees have no builder, so no element shape either. */
    /* An `arrayOf` subtree with no element declaration judges nothing at all, which is the one
       state that makes the whole declaration pointless. It names itself here, before the element
       loop that an empty declaration would never enter. */
    if (byArray && !Object.keys(d.elements || {}).length) throw new Error(`nested subtree \`${sub}\` declares arrayOf:true and no element shape, so it would judge no key at all`);
    const elementShapes = {};
    for (const vn of Object.keys(d.elements || {})) {
      const ed = (d.elements || {})[vn] || {};
      /* 🔴 THE ELEMENT'S BUILDER IS NOT ALWAYS THE SUBTREE'S BUILDER. `clockSkew` has no `builtBy`
         at all — it is an inline literal at the publish site — while its `findings` elements are
         pushed by `detectClockSkew` one function away. So an element declaration may name its OWN
         builder and the array it pushes into, and the gate reads the push literal there. */
      /* 🔴 ONE ELEMENT, SEVERAL BUILD ROUTES, AND EVERY DECLARED ROUTE MUST BE READABLE.
         `vetoes` is built by a `.map` return literal AND by a push, so its shape is the union of
         the two and `partial` names the keys one route omits. A declared route the reader cannot
         find NAMES ITSELF here rather than leaving a half shape that still looks whole — the
         `servesKeys` lesson from 2026-11-12, applied one level down. */
      /* 🔴 AND A ROUTE THAT IS NOT IN A BUILDER AT ALL. A top-level export array builds its
         element in the EXPORT literal, so the element's route names the export entry rather than a
         function. Each route carries where it reads from, because a refusal that cannot say where
         it looked costs the next session the search. */
      const sources = [];
      if (ed.builtBy && ed.mappedFrom) sources.push(['map', mapShapes(dsp, ed.builtBy, ed.mappedFrom), `${ed.builtBy}()`]);
      if (ed.builtBy && ed.pushInto) sources.push(['push', pushShapes(dsp, ed.builtBy, ed.pushInto), `${ed.builtBy}()`]);
      if (ed.exportMapped) sources.push(['export-map', exportMapShape(dsp, ed.exportMapped), `the \`${ed.exportMapped}:\` entry of the export literal`]);
      const unread = sources.filter(([, x]) => !x);
      if (unread.length)
        throw new Error(
          `the element shape \`${vn}\` declares the ${unread.map(([k]) => k).join(' and ')} build route this gate cannot read in ${[...new Set(unread.map(([, , o]) => o))].join(' and ')} — the route moved, it is declared twice, or its literal does not close`
        );
      const es = sources.length ? mergeShapes(sources.flatMap(([, x]) => x.sites)) : byFn ? elementShape(dsp, d.builtBy, vn) : null;
      if (!es)
        throw new Error(
          byFn
            ? `the element literal \`${vn}\` inside ${d.builtBy}() was not found, appears more than once, or does not close on one line — its shape changed, and this gate must not guess`
            : `nested subtree \`${sub}\` is an inline literal and declares the element shape \`${vn}\`, which has no builder to read it from`
        );
      elementShapes[vn] = es;
    }
    /* An inner literal is read from the SAME source the parent shape came from, and anchored inside
       the parent's own literal. A declared inner the reader cannot find refuses here, beside the
       parent's refusal, rather than reporting a surface it never saw. */
    const innerShapes = {};
    for (const vn of Object.keys(d.inner || {})) {
      const is = innerShape(dsp, sub, vn);
      if (!is)
        throw new Error(
          `the inner literal \`${sub}.${vn}\` was not found inside the \`${sub}: {\` literal in integrator-dsp.js, or it does not close — its shape changed, and this gate must not guess`
        );
      innerShapes[vn] = is;
    }
    nested.push(evaluateNested(sub, shapes, d, rlist[0].text, { readers: rlist, elementShapes, innerShapes }));
  }
  const nestedBad = nested.filter((n) => !n.ok);
  const nestedKeys = nested.reduce((t, n) => t + n.keys.length, 0);
  const nestedInnerKeys = nested.reduce((t, n) => t + (n.inners || []).reduce((u, i) => u + i.keys.length, 0), 0);
  const nestedCard = nested.reduce((t, n) => t + n.keys.filter((k) => (decl.nested[n.subtree].surfaces || {})[k] === 'card').length, 0);
  const cards = keys.filter((k) => (decl.surfaces || {})[k] === 'card').length;
  const v = Verdict.make({
    gate: 'integrator-surface',
    scope: 'internal',
    status: r.ok && !nestedBad.length ? 'PASS' : 'FAIL',
    population: { checked: keys.length + nestedKeys + nestedInnerKeys, eligible: keys.length + nestedKeys + nestedInnerKeys, excluded: 0 },
    criterion: { name: 'undeclared_or_misdeclared_keys', threshold: 0, unit: 'keys', direction: 'lte' },
    result: {
      keys: keys.length,
      /* 🔴 THE POPULATION, STATED. The brief counts 108 keys at depth <= 2. `depth` stays the
         TOP-level depth, and `nestedSubtrees` names the subtrees judged one level deeper. A
         subtree absent from that list is NOT examined and is not claimed. */
      depth: 1,
      nestedSubtrees: nested.map((n) => n.subtree),
      nestedKeys,
      nestedCard,
      nestedExportOnly: nestedKeys - nestedCard,
      nestedPartialShape: nested.reduce((t, n) => t + n.partial.length, 0),
      nestedUndeclared: nested.reduce((t, n) => t + n.undeclared.length, 0),
      nestedCardUnrendered: nested.reduce((t, n) => t + n.cardUnrendered.length, 0),
      nestedExportOnlyRead: nested.reduce((t, n) => t + n.exportOnlyRead.length, 0),
      nestedAliasSites: nested.reduce((t, n) => t + n.aliasSites.length, 0),
      nestedAliasShadowed: nested.reduce((t, n) => t + n.aliasSites.filter((a) => a.shadows.length).length, 0),
      nestedForwardedSites: nested.reduce((t, n) => t + n.forwarded.length, 0),
      /* 🔴 REPORTED, NEVER RED — AND INVISIBLE UNTIL NOW. `staleDeclarations` states the same fact at
         depth 1, where a declaration for a key the fusion dropped is deliberately not a red: the
         removal is the author's, and the gate only has to say so. `evaluateNested` computed the
         nested twin at the same time and no metric and no reason ever read it, so a depth-2
         declaration could name a key its literal no longer carries and the gate printed nothing.
         Measured 2026-11-13 as control W2 on `fusion.window`: GREEN, with no line about it. */
      nestedStaleDeclarations: nested.reduce((t, n) => t + n.stale.length, 0),
      nestedStaleWhere: nested.flatMap((n) => n.stale.map((k) => n.subtree + '.' + k)),
      nestedReaderFiles: [...new Set(nested.flatMap((n) => n.readerFiles || [n.readerFile]))],
      nestedCardByReader: nested.reduce((acc, n) => {
        for (const [f, c] of Object.entries(n.cardByReader || {})) acc[f] = (acc[f] || 0) + c;
        return acc;
      }, {}),
      /* The count of subtrees read from a LITERAL, which `shapeKind` states outright. It keyed on
         `partialKind === 'undefined-value'` until a two-route literal earned its own kind, and a
         proxy for a fact the reader already returns is a miscount waiting for the next kind. */
      nestedInline: nested.filter((n) => n.shapeKind === 'inline').length,
      /* A subtree read over SEVERAL export routes, each with its own source form. The count says
         how many subtrees needed more than one reader to state their whole surface. */
      nestedRouted: nested.filter((n) => n.shapeKind === 'routes').length,
      /* The inner layer's own census. `innerStale` is reported and never red, so a reader needs the
         count here or the fact reaches nobody — the `nestedStaleDeclarations` lesson, applied as
         the layer ships rather than one unit later. */
      innerLiterals: nested.reduce((t, n) => t + (n.inners || []).length, 0),
      innerKeys: nestedInnerKeys,
      innerWhere: nested.flatMap((n) => (n.inners || []).map((i) => n.subtree + '.' + i.name + '{' + i.keys.length + '}')),
      innerStaleDeclarations: nested.reduce((t, n) => t + (n.innerStale || []).length, 0),
      innerStaleWhere: nested.flatMap((n) => (n.innerStale || []).map((k) => n.subtree + '.' + k)),
      elementShapes: nested.reduce((t, n) => t + (n.elements || []).length, 0),
      elementKeys: nested.reduce((t, n) => t + (n.elements || []).reduce((u, e) => u + e.keys.length, 0), 0),
      elementCard: nested.reduce((t, n) => t + (n.elements || []).reduce((u, e) => u + Object.values(e.cardByReader || {}).reduce((v, c) => v + c, 0), 0), 0),
      elementSites: nested.reduce((t, n) => t + (n.elements || []).reduce((u, e) => u + (e.sites || []).length, 0), 0),
      /* A union over push sites can carry a key only SOME site writes, so the count says how many
         element keys are conditional rather than leaving the union to read as one fixed shape. */
      elementPartial: nested.reduce((t, n) => t + (n.elements || []).reduce((u, e) => u + (e.partial || []).length, 0), 0),
      elementCardUnread: nested.reduce((t, n) => t + (n.elemCardUnread || []).length, 0),
      elementExportOnlyRead: nested.reduce((t, n) => t + (n.elemExportOnlyRead || []).length, 0),
      elementReadsUnjudged: nested.reduce((t, n) => t + (n.elemUnjudged || []).length, 0),
      elementReadsUnjudgedWhere: nested.flatMap((n) => (n.elemUnjudged || []).map((u) => `${u.prefix}.${u.arrayKey} at ${u.file}:${u.line}`)),
      card: cards,
      exportOnly: keys.length - cards,
      undeclared: r.undeclared.length,
      cardUnrendered: r.cardUnrendered.length,
      cardProseOnly: r.cardProseOnly.length,
      cardUnanchored: r.cardUnanchored.length,
      exportOnlyRead: r.exportOnlyRead.length,
      exportOnlyReadElsewhere: r.exportOnlyReadElsewhere.length,
      readerRealms: r.realms,
      cardByRealm: r.cardByRealm,
      staleDeclarations: r.stale.length,
      blankedBy: r.blankedBy
    },
    evidence: ['tools/integrator-surface-gate.mjs', 'tools/integrator-surface.json', 'briefs/INTEGRATOR-SURFACE-2026-10-11-BRIEF.md'],
    reason:
      r.ok && !nestedBad.length
        ? null
        : [
            r.undeclared.length ? r.undeclared.length + ' key(s) declare no surface: ' + r.undeclared.join(', ') : '',
            r.badValue.length ? r.badValue.length + " key(s) declare something other than 'card' or 'export-only': " + r.badValue.join(', ') : '',
            r.cardUnrendered.length
              ? r.cardUnrendered.length +
                " key(s) declare 'card' and their own declared reader does not read them: " +
                Object.entries(r.cardUnrenderedByRealm)
                  .map(([f, ks]) => f + ' → ' + ks.join(', '))
                  .join(' · ')
              : '',
            r.cardProseOnly.length ? r.cardProseOnly.length + ' of those appear ONLY in prose, a comment or a string, and never as a read: ' + r.cardProseOnly.join(', ') : '',
            r.cardUnanchored.length
              ? r.cardUnanchored.length + ' of those are mentioned in their own realm but never read through its holder, so the mention is a comment or another object: ' + r.cardUnanchored.join(', ')
              : '',
            r.exportOnlyRead.length ? r.exportOnlyRead.length + " key(s) declare 'export-only' and integrator-render.js reads them: " + r.exportOnlyRead.join(', ') : '',
            r.exportOnlyReadElsewhere.length
              ? r.exportOnlyReadElsewhere.length + " key(s) declare 'export-only' and a SECOND declared realm reads them through its holder: " + r.exportOnlyReadElsewhere.join(', ')
              : '',
            r.badRealm.length ? r.badRealm.length + ' key(s) name a reader file that is not a declared realm: ' + r.badRealm.join(', ') : ''
          ]
            .concat(nestedBad.flatMap((n) => nestedReasons(n)))
            .filter(Boolean)
            .join(' · '),
    producedBy: { tool: 'tools/integrator-surface-gate.mjs', commit: gitCommit() }
  });
  /* `--json` is the documented "verdict only": without it stdout carries the object AND the ✓ line,
     which reads well and does not parse. Nothing read the flag until 2026-10-21. */
  const JSON_ONLY = process.argv.includes('--json');
  console.log(JSON.stringify(v));
  if (!r.ok || nestedBad.length) {
    console.error('✗ ' + v.reason);
    process.exit(1);
  }
  if (!JSON_ONLY)
    console.log(
      `✓ ${keys.length} top-level Integrator key(s): ${cards} card · ${keys.length - cards} export-only · 0 undeclared · reads blanked by ${r.blankedBy}` +
        ` · ${r.realms.length} declared reader realm(s): ${r.realms.map((f) => f + '=' + r.cardByRealm[f] + ' card').join(' · ')}` +
        ` · depth 1 — a nested property is examined only inside a declared subtree (${nested.length} declared)`
    );
  if (!JSON_ONLY)
    for (const n of nested)
      console.log(
        `  ✓ ${n.path} at depth 2: ${n.keys.length} key(s) · ${n.keys.filter((k) => (decl.nested[n.subtree].surfaces || {})[k] === 'card').length} card · ${n.partial.length} ${n.partialKind === 'undefined-value' ? 'able to evaluate to `undefined`' : n.partialKind === 'export-route' ? 'on one export route only' : 'on some return shape(s) only'}` +
          ` · ${(n.readerFiles || [n.readerFile]).length} realm(s): ${Object.entries(n.cardByReader || {})
            .map(([f, c]) => f + '=' + c + ' card')
            .join(' · ')}` +
          ` · ${n.aliasSites.length} anchored alias site(s) (${aliasLabel(n.aliasSites)})` +
          (n.stale.length ? ` · ${n.stale.length} declared key(s) the literal no longer carries (${n.stale.join(', ')})` : '') +
          (n.forwarded.length ? ` + ${n.forwarded.length} one-hop forward (${forwardLabel(n.forwarded)})` : '') +
          ((n.elements || []).length
            ? ` · depth 3: ${n.elements
                .map(
                  (e) =>
                    `${e.name}{${e.keys.length}} over ${e.serves.join(' + ')}${
                      (e.siteAt || []).length > 1 ? ` from ${e.siteAt.length} build site(s)` : ''
                    }${(e.partial || []).length ? ` · ${e.partial.length} key(s) on some build site(s) only` : ''} · ${Object.entries(e.cardByReader || {})
                      .map(([f, c]) => f + '=' + c + ' card')
                      .join(' · ')} · ${(e.sites || []).length} element read site(s)`
                )
                .join(' · ')}`
            : '') +
          ((n.inners || []).length
            ? ` · inner object(s): ${n.inners.map((i) => `${i.name}{${i.keys.length}} at :${i.at}${(i.partial || []).length ? ` · ${i.partial.length} key(s) on one route only` : ''}`).join(' · ')}`
            : '') +
          ((n.innerStale || []).length ? ` · ${n.innerStale.length} declared inner key(s) the literal no longer carries (${n.innerStale.join(', ')})` : '') +
          ((n.elemUnjudged || []).length ? ` · ${n.elemUnjudged.length} element read(s) UNJUDGED (${n.elemUnjudged.map((u) => u.arrayKey + '@' + u.file + ':' + u.line).join(', ')})` : '')
      );
  if (r.stale.length) console.log(`  note: ${r.stale.length} declaration(s) name a key the fusion no longer emits (${r.stale.join(', ')}) — not a red, but worth pruning`);
  process.exit(0);
}

const DIRECT = isCliEntry(import.meta.url);

if (DIRECT && process.argv.includes('--verdict-sample')) {
  console.log(
    JSON.stringify(
      Verdict.make({
        gate: 'integrator-surface',
        scope: 'internal',
        status: 'NOT_RUN',
        population: { checked: 0, eligible: 0, excluded: 0 },
        criterion: { name: 'undeclared_or_misdeclared_keys', threshold: 0, unit: 'keys', direction: 'lte' },
        result: null,
        evidence: ['tools/integrator-surface-gate.mjs'],
        reason: 'sample only — this invocation read no source and checked no key',
        producedBy: { tool: 'tools/integrator-surface-gate.mjs', commit: gitCommit() }
      }),
      null,
      2
    )
  );
  process.exit(0);
}

if (DIRECT && process.argv.includes('--selftest')) {
  let bad = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      bad++;
      console.log(`  ✕ ${n} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    } else console.log(`  ✓ ${n}`);
  };
  /* `alpha` appears as a bare token; `delta` deliberately does not. */
  const R = 'function draw(){ renderCard(alpha); showBeta(); }';
  /* 🔴 THE PROSE FIXTURES — the state that satisfied this gate until 2026-11-11. `iota` is a word
     in a comment, `kappa` a word inside a string, and the code reads neither. */
  const PROSE = 'function draw(){ /* the iota of it */ out("truth on the kappa"); }';
  const BRACKET = "function draw(){ return fusion['mu']; }";
  /* 🔴 THE TWO DRIFT STATES, PLANTED. Today's PASS is derived; these are what the gate is for. */
  ck('a NEW undeclared key reds', evaluate(['alpha', 'gamma'], { alpha: 'card' }, R).undeclared, ['gamma']);
  ck("…and a 'card' key whose render mention is DELETED reds", evaluate(['delta'], { delta: 'card' }, R).cardUnrendered, ['delta']);
  ck('both together are not ok', evaluate(['gamma', 'delta'], { delta: 'card' }, R).ok, false);
  /* The non-red cases, equally deliberate. */
  ck("'export-only' is never red, even with no render mention", evaluate(['zeta'], { zeta: 'export-only' }, R).ok, true);
  ck("a 'card' key WITH a mention passes", evaluate(['alpha'], { alpha: 'card' }, R).ok, true);
  ck('an unknown surface value reds', evaluate(['alpha'], { alpha: 'hidden' }, R).badValue, ['alpha']);
  ck('a declaration for a key the fusion dropped is reported, not red', evaluate(['alpha'], { alpha: 'card', old: 'card' }, R).stale, ['old']);
  ck('…and that alone stays ok', evaluate(['alpha'], { alpha: 'card', old: 'card' }, R).ok, true);
  /* Word boundaries: a longer identifier that merely CONTAINS the key is not a mention. */
  ck('a substring is not a mention', mentions('showAlphaBeta()', 'alpha'), false);
  ck('…and the exact token is', mentions('showAlpha(); alpha;', 'alpha'), true);
  /* The enumerator must REFUSE rather than return a short list if the fusion's shape moves. */
  let threw = false;
  try {
    fusionKeys('function f(){ return 1; }');
  } catch {
    threw = true;
  }
  ck('🔴 a changed fusion shape REFUSES — never a silently short key list', threw, true);
  ck('the enumerator finds the real keys', fusionKeys('x = function(){\n  return {\n    hrSource: hrSource,\n    apnea: apnea\n  };\n}').includes('apnea'), true);
  ck('…and _exp assignments join them', fusionKeys('x=function(){\n  return {\n    hrSource: hrSource\n  };\n}\n_exp.extra = 1;').includes('extra'), true);
  /* 🔴 THE SECOND EXPORT ROUTE, PLANTED. `nu` and `xi` are the literal's own keys, `buried` sits one
     level down inside `schema`, and `xi` is the literal key nobody declared. */
  const EXPSRC = 'x=function(){\n  return {\n    hrSource: hrSource\n  };\n}\n  var _exp = {\n    nu: 1,\n    schema: {\n      buried: 2\n    },\n    xi: 3\n  };\n';
  ck('🔴 the slim-export LITERAL keys join the population', fusionKeys(EXPSRC), ['hrSource', 'nu', 'schema', 'xi']);
  ck('…and a key one level DOWN is not one of them — the gate judges depth 1', fusionKeys(EXPSRC).includes('buried'), false);
  ck('…so a literal-only key nobody declared reds', evaluate(fusionKeys(EXPSRC), { hrSource: 'export-only', nu: 'export-only', schema: 'export-only' }, R).undeclared, ['xi']);
  ck('a text with no such literal returns null, not an empty list', exportLiteralKeys('var other = { a: 1 };'), null);
  ck('…and an UNTERMINATED literal returns null too — it fails closed', exportLiteralKeys('  var _exp = {\n    nu: 1,\n'), null);
  ck('the literal reader finds the keys at its own depth', exportLiteralKeys(EXPSRC), ['nu', 'schema', 'xi']);
  ck('the surfaces are exactly two', SURFACES, ['card', 'export-only']);
  /* 🔴 A MENTION IS NOT A READ — the three states added 2026-11-11, each planted. */
  ck("🔴 a 'card' key whose only mention is a COMMENT reds", evaluate(['iota'], { iota: 'card' }, PROSE).cardUnrendered, ['iota']);
  ck('…and the reason names it as prose, not as absence', evaluate(['iota'], { iota: 'card' }, PROSE).cardProseOnly, ['iota']);
  ck("🔴 a 'card' key whose only mention is a STRING reds", evaluate(['kappa'], { kappa: 'card' }, PROSE).cardUnrendered, ['kappa']);
  ck('a key absent from the text is NOT prose-only', evaluate(['delta'], { delta: 'card' }, R).cardProseOnly, []);
  ck('the raw token test still answers TRUE for prose — the two tests differ', mentions(PROSE, 'kappa'), true);
  ck("🔴 an 'export-only' key the render READS reds", evaluate(['alpha'], { alpha: 'export-only' }, R).exportOnlyRead, ['alpha']);
  ck('…and one named only in prose does not', evaluate(['kappa'], { kappa: 'export-only' }, PROSE).exportOnlyRead, []);
  ck('a bracket access with a literal key IS a read', evaluate(['mu'], { mu: 'card' }, BRACKET).cardUnrendered, []);
  ck('the blanking route is recorded', ['acorn', 'tokenizer'].includes(evaluate(['alpha'], { alpha: 'card' }, R).blankedBy), true);
  /* ── DEPTH 2, PLANTED ────────────────────────────────────────────────────────────────────────
     `NSRC` returns from two places, so `gamma` exists on one shape only. `NREN` reads `a.alpha`
     through the alias and carries `beta` as a BARE token that no anchored read reaches — which is
     the control for the whole anchoring argument. `gamma` appears in neither. */
  const NSRC = ['function fuseThing(x) {', '  if (!x)', '    return {', '      alpha: 1,', '      beta: 2', '    };', '  return {', '    alpha: 1,', '    beta: 2,', '    gamma: 3', '  };', '}'].join(
    '\n'
  );
  const NREN = ['function card(fusion) {', '  var a = fusion.thing;', '  if (a) {', '    show(a.alpha);', '    show(beta);', '  }', '}'].join('\n');
  const NSHADOW = NREN.replace('    show(beta);', '    rows.sort(function (a, b) { return a - b; });');
  const NSHAPES = nestedShapes(NSRC, 'fuseThing');
  const NDECL = { builtBy: 'fuseThing', surfaces: { alpha: 'card', beta: 'export-only', gamma: 'export-only' }, partialShape: { gamma: 'the fused path only' } };
  const withDecl = (over, ren) => evaluateNested('thing', NSHAPES, { ...NDECL, ...over }, ren || NREN);
  ck('🔴 the nested enumerator unions EVERY return shape', NSHAPES.union, ['alpha', 'beta', 'gamma']);
  ck('…and names the key that only some shapes carry', NSHAPES.partial, ['gamma']);
  ck(
    '…and reports both shapes with their key counts',
    NSHAPES.shapes.map((x) => x.keys.length),
    [2, 3]
  );
  ck('a fully declared subtree is ok', withDecl({}).ok, true);
  ck('🔴 a new nested key nobody declared reds', withDecl({ surfaces: { alpha: 'card', beta: 'export-only' } }).undeclared, ['gamma']);
  /* 🔴 THE CONTROL FOR THE ANCHOR. `beta` is a bare token in the render text, so the depth-1 test
     would credit it. No read reaches it THROUGH the alias, so the nested test does not. */
  ck('🔴 a bare token is not a nested read — the anchored test reds it', withDecl({ surfaces: { alpha: 'card', beta: 'card', gamma: 'export-only' } }).cardUnrendered, ['beta']);
  ck('…while the depth-1 test says that same token IS mentioned, so the two differ', mentions(NREN, 'beta'), true);
  ck('…and the aliased key is credited', withDecl({}).cardUnrendered, []);
  ck("🔴 an 'export-only' nested key an anchored read reaches reds", withDecl({ surfaces: { alpha: 'export-only', beta: 'export-only', gamma: 'export-only' } }).exportOnlyRead, ['alpha']);
  ck('🔴 a key on some shapes only must declare WHY, or it reds', withDecl({ partialShape: {} }).undeclaredPartial, ['gamma']);
  ck('…and a partialShape naming a key every shape carries is stale, and reds', withDecl({ partialShape: { alpha: 'x', gamma: 'y' } }).stalePartial, ['alpha']);
  /* 🔴 THE SHADOW. A comparator parameter rebinds the alias, so the scope credits nothing and the
     subtree's `card` keys red — it fails CLOSED rather than crediting another object's property. */
  ck('🔴 a rebound alias shadows its scope', withDecl({}, NSHADOW).aliasSites[0].shadows.length > 0, true);
  ck('…so no nested read is credited at all', withDecl({}, NSHADOW).noAlias, true);
  ck('…and the subtree is not ok', withDecl({}, NSHADOW).ok, false);
  ck('…and the reason names the binding, not the keys, first', nestedReasons(withDecl({}, NSHADOW))[0].includes('no usable binding'), true);
  /* 🔴 THE CONTROL THE FIRST SHADOW TEST FAILED. `if (a) {` is not a parameter list; a test that
     cannot tell them apart reported both real alias sites shadowed and credited nothing. */
  ck('🔴 an `if (alias) {` guard is NOT a shadow', withDecl({}).aliasSites[0].shadows, []);
  ck('the alias and its line are reported', [withDecl({}).aliasSites[0].alias, withDecl({}).aliasSites[0].line], ['a', 2]);
  ck(
    'a bracket access with a literal key is an anchored read too',
    readsNested(
      "function c(fusion) {\n  var a = fusion.thing;\n  if (a) {\n    show(a['gamma']);\n  }\n}",
      aliasSites("function c(fusion) {\n  var a = fusion.thing;\n  if (a) {\n    show(a['gamma']);\n  }\n}", 'fusion.thing').sites,
      'gamma'
    ),
    true
  );
  ck('🔴 a moved builder shape returns null — never a short key list', nestedShapes(NSRC, 'fuseSomethingElse'), null);
  ck('…and an UNTERMINATED return object returns null too', nestedShapes('function f(x) {\n  return {\n    alpha: 1\n}', 'f'), null);
  ck('a builder with no return object literal returns null', nestedShapes('function f(x) {\n  return 1;\n}', 'f'), null);
  ck('a render that never binds the subtree resolves no alias', aliasSites('function c(fusion) {\n  show(fusion.other);\n}', 'fusion.thing').sites, []);
  /* ── THE SECOND NESTED SUBTREE: AN INLINE LITERAL, READ FROM THE APP, BOUND BEHIND A GUARD ──
     `ISRC` publishes `skewBlock` as a literal AT the fusion return, with no builder function.
     `IAPP` is app-shaped: it binds the subtree behind a `&&` guard, nine lines under a callback
     that has already closed, and hands the same object to a one-parameter helper. Each refusal
     below is planted: a two-parameter helper, a second hop, and a duplicate helper name. */
  const ISRC = [
    'function runFusion(recs) {',
    '  return {',
    '    other: 1,',
    '    skewBlock: {',
    '      findings: skew.findings,',
    '      census: skew.census || [],',
    '      beat: skew.beat || null,',
    '      inner: { deeper: 1 },',
    '      vetoes: skew.vetoes && skew.vetoes.length ? skew.vetoes : undefined',
    '    },',
    '    tail: 2',
    '  };',
    '}'
  ].join('\n');
  const IAPP = [
    'function helper(cs) {',
    '  var v = cs.vetoes || [];',
    '  if (second(cs)) show(1);',
    '  return v.length;',
    '}',
    'function second(cs) {',
    '  return cs.beat;',
    '}',
    'function two(cs, n) {',
    '  return cs.census.length + n;',
    '}',
    'function recompute() {',
    '  xs.forEach(function (m) {',
    '    show(m);',
    '  });',
    '  var cs = FUSION && FUSION.skewBlock;',
    '  if (cs && cs.findings) show(cs.findings);',
    '  var out = helper(cs);',
    '  var t = two(cs, 1);',
    '  return out + t;',
    '}'
  ].join('\n');
  const ISHAPES = inlineShape(ISRC, 'skewBlock');
  const IDECL = {
    inline: true,
    readerFile: 'integrator-app.js',
    aliasPath: 'FUSION.skewBlock',
    surfaces: { findings: 'card', vetoes: 'card', census: 'export-only', beat: 'export-only', inner: 'export-only' },
    partialShape: { vetoes: 'absent when the pass refused nothing' }
  };
  const withI = (over, ren) => evaluateNested('skewBlock', ISHAPES, { ...IDECL, ...over }, ren || IAPP);
  ck('🔴 a subtree with no builder is read from its inline literal', ISHAPES.union, ['beat', 'census', 'findings', 'inner', 'vetoes']);
  ck('…at its own depth only — a key one level further down is not one of them', ISHAPES.union.includes('deeper'), false);
  ck('…and one literal is one shape', ISHAPES.shapes.length, 1);
  ck('🔴 a key whose value can be `undefined` is conditional, so it joins partial', ISHAPES.partial, ['vetoes']);
  ck('…and the mechanism is named, because it is not a missing return shape', ISHAPES.partialKind, 'undefined-value');
  ck('a `|| null` key is NOT conditional — a null is a value a consumer reads (§∅)', ISHAPES.partial.includes('beat'), false);
  ck('a moved anchor returns null, never a short key list', inlineShape(ISRC, 'noSuchBlock'), null);
  /* 🔴 MORE THAN ONE ANCHOR IS NOT AMBIGUITY — IT IS THE EXPORT'S TWO ROUTES. This leg asserted a
     refusal on `at.length !== 1` until 2026-11-13, and that refusal is what hid `fusion.window`:
     integrator-dsp.js writes the subtree twice, in the full `runFusion` export and in the slim
     `var _exp = {` projection, and the two key lists differ. The reader now judges the UNION and
     names which route a key is missing from. */
  const IR2 = ['x = {', '  win: {', '    a: 1,', '    b: 2', '  }', '};'].join('\n');
  const IR2B = ['y = {', '  win: {', '    a: 1,', '    b: 2,', '    c: 3', '  }', '};'].join('\n');
  const IRTWO = inlineShape(IR2 + '\n' + IR2B, 'win');
  ck('🔴 TWO anchors are TWO shapes, and the union is the surface', [IRTWO.shapes.length, IRTWO.union], [2, ['a', 'b', 'c']]);
  ck('…the key one route omits is partial', IRTWO.partial, ['c']);
  ck('…and the mechanism is the export route, not an `undefined` value', IRTWO.partialKind, 'export-route');
  ck('…while the shape source stays the literal', IRTWO.shapeKind, 'inline');
  ck('two IDENTICAL literals conflict over nothing', inlineShape(IR2 + '\n' + IR2, 'win').partial, []);
  /* 🔴 TWO MECHANISMS CANNOT WEAR ONE `partialKind`, so the reader refuses rather than pick. */
  const IRU = ['z = {', '  win: {', '    a: 1,', '    b: f ? 2 : undefined', '  }', '};'].join('\n');
  const twoWhy = (() => {
    try {
      inlineShape(IRU + '\n' + IR2B, 'win');
      return null;
    } catch (e) {
      return e.message;
    }
  })();
  ck('🔴 a route-missing key AND an undefined-valued key together refuse', twoWhy !== null, true);
  ck('…and the refusal says one partialKind cannot state both', (twoWhy || '').includes('cannot state both'), true);
  ck('…and an unterminated literal returns null too', inlineShape('x = {\n  skewBlock: {\n    findings: 1,\n', 'skewBlock'), null);
  /* 🔴 THE REGRESSION THIS SUBTREE FOUND. The binding sits under a `forEach(function (m) {` that
     closed four lines earlier, and the first-header-above scan called the site UNSCOPED. */
  ck('🔴 a binding under a CLOSED callback still resolves its scope', aliasSites(IAPP, 'FUSION.skewBlock').sites.length, 1);
  ck('…and nothing is left unresolved', aliasSites(IAPP, 'FUSION.skewBlock').unresolved, []);
  ck('a `&&` guard in front of the path is still a binding', aliasSites(IAPP, 'FUSION.skewBlock').sites[0].alias, 'cs');
  ck(
    '🔴 one forwarding hop is credited, and it names the helper it went through',
    withI({}).forwarded.map((f) => f.via),
    ['helper']
  );
  ck('…so a key read only inside that helper counts as rendered', withI({}).cardUnrendered, []);
  ck('🔴 a TWO-parameter helper is refused — the gate cannot tell which argument it got', withI({ surfaces: { ...IDECL.surfaces, census: 'card' } }).cardUnrendered, ['census']);
  ck('🔴 a SECOND hop is refused — an unbounded credit is no credit', withI({ surfaces: { ...IDECL.surfaces, beat: 'card' } }).cardUnrendered, ['beat']);
  ck(
    '🔴 a duplicate helper name is refused rather than picked',
    forwardedSites(IAPP.replace('function two(cs, n) {', 'function helper(cs, n) {').split('\n'), aliasSites(IAPP, 'FUSION.skewBlock').sites),
    []
  );
  ck('the subtree reports which file it was read in', withI({}).readerFile, 'integrator-app.js');
  ck('🔴 an undeclared `undefined`-valued key reds', withI({ partialShape: {} }).undeclaredPartial, ['vetoes']);
  ck('…and the reason names the mechanism, not a missing return shape', nestedReasons(withI({ partialShape: {} }))[0].includes('`undefined`'), true);
  /* 🔴 A BINDING IS OWED ONLY WHERE A READ MUST BE CREDITED. A subtree with no `card` key has
     nothing to credit, so an absent alias is not a finding — this is the state `fusion.clockSkew`
     is in against `integrator-render.js`, which mentions it zero times. */
  const ALLEXP = { inline: true, surfaces: { findings: 'export-only', vetoes: 'export-only', census: 'export-only', beat: 'export-only', inner: 'export-only' }, partialShape: { vetoes: 'x' } };
  ck('🔴 an all-export-only subtree with NO alias is ok, not red', evaluateNested('skewBlock', ISHAPES, ALLEXP, 'function f() {\n  return 1;\n}').ok, true);
  ck('…and the gate says so rather than demanding a binding', evaluateNested('skewBlock', ISHAPES, ALLEXP, 'function f() {\n  return 1;\n}').noAlias, false);
  ck(
    '…while ONE card key with no alias reds again',
    evaluateNested('skewBlock', ISHAPES, { ...ALLEXP, surfaces: { ...ALLEXP.surfaces, findings: 'card' } }, 'function f() {\n  return 1;\n}').noAlias,
    true
  );
  /* ── DEPTH 1 IN A SECOND REALM ─────────────────────────────────────────────────────────────
     The render realm keeps the bare-token test. Every other realm is asked for an anchored read,
     because the token in a second file is not the fusion's property name — `AR` below is the
     measured shape of `generated` and `schema` in `integrator-app.js`, which build an envelope
     of their own and never read the fusion. */
  const AR = "function recompute(){ var ka = FUSION && FUSION.kernelAudit; out(ka.expected); var env = { generated: now(), schema: { name: 'x' } }; return env['kind']; }";
  const ARREALMS = () => [
    { file: 'integrator-render.js', raw: R, isDefault: true, holder: null },
    { file: 'integrator-app.js', raw: AR, isDefault: false, holder: 'FUSION' }
  ];
  const ev1 = (keys, surfaces, readerFiles) => evaluate(keys, surfaces, R, { realms: ARREALMS(), readerFiles: readerFiles || {} });
  ck('an anchored property read in a second realm counts', readsAnchored(AR, AR, 'FUSION', 'kernelAudit'), true);
  ck('🔴 a bare token in a second realm does NOT', readsAnchored(AR, AR, 'FUSION', 'generated'), false);
  ck('…and neither does a bracket access on something else', readsAnchored(AR, AR, 'FUSION', 'kind'), false);
  ck('a bracket access on the holder DOES count', readsAnchored('', "FUSION['nu']", 'FUSION', 'nu'), true);
  ck('a longer identifier containing the key is not an anchored read', readsAnchored('FUSION.kernelAuditTrail', '', 'FUSION', 'kernelAudit'), false);
  ck("🔴 an 'export-only' key a SECOND realm reads reds", ev1(['kernelAudit'], { kernelAudit: 'export-only' }).exportOnlyReadElsewhere, ['kernelAudit']);
  ck('…and that alone is not ok', ev1(['kernelAudit'], { kernelAudit: 'export-only' }).ok, false);
  ck('…while the reason names the second realm rather than render', ev1(['kernelAudit'], { kernelAudit: 'export-only' }).exportOnlyRead, []);
  ck('🔴 the three bare-token-only keys stay export-only with NO finding', ev1(['generated', 'kind', 'schema'], { generated: 'export-only', kind: 'export-only', schema: 'export-only' }).ok, true);
  ck("a 'card' key that names the second realm passes on an anchored read", ev1(['kernelAudit'], { kernelAudit: 'card' }, { kernelAudit: 'integrator-app.js' }).ok, true);
  ck('🔴 …and reds when that realm only has a bare token', ev1(['generated'], { generated: 'card' }, { generated: 'integrator-app.js' }).cardUnrendered, ['generated']);
  ck('🔴 a card key whose realm is the WRONG one reds', ev1(['kernelAudit'], { kernelAudit: 'card' }).cardUnrendered, ['kernelAudit']);
  /* 🔴 MENTIONED-BUT-NOT-ANCHORED IS ITS OWN STATE, and it is not prose. */
  ck('a second-realm mention with no holder read is reported as unanchored', ev1(['generated'], { generated: 'card' }, { generated: 'integrator-app.js' }).cardUnanchored, ['generated']);
  ck('…and NOT as prose-only, which would send a reader looking for a comment', ev1(['generated'], { generated: 'card' }, { generated: 'integrator-app.js' }).cardProseOnly, []);
  ck('a key absent from its realm altogether is neither', ev1(['omega'], { omega: 'card' }, { omega: 'integrator-app.js' }).cardUnanchored, []);
  ck('…while the render realm keeps reporting prose-only', evaluate(['iota'], { iota: 'card' }, PROSE).cardProseOnly, ['iota']);
  ck('🔴 a reader file that is not a declared realm reds', ev1(['alpha'], { alpha: 'card' }, { alpha: 'integrator-nowhere.js' }).badRealm, ['alpha']);
  ck('the card count is reported per realm', ev1(['alpha', 'kernelAudit'], { alpha: 'card', kernelAudit: 'card' }, { kernelAudit: 'integrator-app.js' }).cardByRealm, {
    'integrator-render.js': 1,
    'integrator-app.js': 1
  });
  ck('the verdict names the realm set', ev1(['alpha'], { alpha: 'card' }).realms, ['integrator-render.js', 'integrator-app.js']);
  /* 🔴 THE REALMS ARE DECLARED, NEVER DISCOVERED, AND THE DECLARATION FAILS CLOSED. */
  const thrown = (f) => {
    try {
      f();
      return null;
    } catch (e) {
      return e.message;
    }
  };
  ck('🔴 a second realm with no holder refuses', thrown(() => realmsFrom(R, { readerRealms: { 'integrator-render.js': {}, 'integrator-app.js': {} } }, () => AR)).includes('declares no holder'), true);
  ck(
    '🔴 a realm set that omits the render file refuses',
    thrown(() => realmsFrom(R, { readerRealms: { 'integrator-app.js': { holder: 'FUSION' } } }, () => AR)).includes('omits integrator-render.js'),
    true
  );
  ck(
    'a declaration with no realms at all is the render realm alone',
    realmsFrom(R, {}, () => AR).map((x) => x.file),
    ['integrator-render.js']
  );
  ck('…which is what a three-argument evaluate still judges against', evaluate(['alpha'], { alpha: 'card' }, R).realms, ['integrator-render.js']);

  /* --- a one-line return object, and whose shape it is ------------------------------- */
  const K1 = [
    'function buildK(recs) {',
    '  var rows = recs.map(function (r) { return { node: r.n, surge: 1 }; });',
    '  var more = recs.map(function (r) {',
    '    return { node: r.n };',
    '  });',
    '  return { expected: 1, nodes: rows, ok: true };',
    '}'
  ].join('\n');
  ck('🔴 a one-line return object reads its depth-1 keys', nestedShapes(K1, 'buildK').union, ['expected', 'nodes', 'ok']);
  ck('…one shape only, so no key of it is conditional', nestedShapes(K1, 'buildK').partial, []);
  ck('…a WHOLLY-INLINE callback return is not the builder shape', nestedShapes(K1, 'buildK').shapes.length, 1);
  ck('…nor is a callback whose header ends its own line', nestedShapes(K1, 'buildK').union.includes('surge'), false);
  ck('oneLineShape refuses a quote in the body', oneLineShape('  return { a: 1, b: "x, y" };'), null);
  ck('oneLineShape refuses a spread', oneLineShape('  return { ...rest, a: 1 };'), null);
  ck('oneLineShape refuses a line whose braces do not balance', oneLineShape('  return { a: 1,'), null);
  ck('oneLineShape refuses an empty object', oneLineShape('  return {};'), null);
  ck('oneLineShape does not credit a nested object key', oneLineShape('  return { a: { b: 1 }, c: 2 };'), ['a', 'c']);
  ck('oneLineShape reads past a comma inside a call', oneLineShape('  return { ok: m.length === 0, n: f(a, b) };'), ['ok', 'n']);

  /* --- a read through the whole path, with no alias binding -------------------------- */
  const KDIR = ['function draw(fusion) {', '  if (fusion.kernelAudit && !fusion.kernelAudit.ok) {', "    warn(fusion.kernelAudit['mismatches']);", '  }', '}'].join('\n');
  ck('🔴 a read through the whole path is credited', readsDirectPath(KDIR, 'fusion.kernelAudit', 'ok'), true);
  ck('…in bracket form too', readsDirectPath(KDIR, 'fusion.kernelAudit', 'mismatches'), true);
  ck('…and a longer identifier is not that key', readsDirectPath(KDIR, 'fusion.kernelAudit', 'o'), false);
  ck('…and a key no reader names stays unread', readsDirectPath(KDIR, 'fusion.kernelAudit', 'nodes'), false);

  /* --- a subtree read in TWO declared realms ----------------------------------------- */
  const KAPP = ['function recompute() {', '  var ka = FUSION && FUSION.kernelAudit;', '  if (ka && ka.expected) {', '    show(ka.expected);', '  }', '}'].join('\n');
  const K2DECL = { builtBy: 'buildK', surfaces: { expected: 'card', nodes: 'export-only', ok: 'card' } };
  const K2 = evaluateNested('kernelAudit', nestedShapes(K1, 'buildK'), K2DECL, KAPP, {
    readers: [
      { file: 'app.js', text: KAPP, aliasPath: 'FUSION.kernelAudit' },
      { file: 'over.js', text: KDIR, aliasPath: 'fusion.kernelAudit' }
    ]
  });
  ck('🔴 a card key read ONLY in the second realm is not unrendered', K2.cardUnrendered, []);
  ck('…and the per-realm count names which realm credited it', K2.cardByReader, { 'app.js': 1, 'over.js': 1 });
  ck('…and the verdict carries the realm set', K2.readerFiles, ['app.js', 'over.js']);
  ck('…while an export-only key read in no realm stays clean', K2.exportOnlyRead, []);
  const K1R = evaluateNested('kernelAudit', nestedShapes(K1, 'buildK'), { ...K2DECL, readerFile: 'app.js', aliasPath: 'FUSION.kernelAudit' }, KAPP);
  ck('a four-argument evaluateNested keeps ONE realm', K1R.readerFiles, ['app.js']);
  ck('…so the key only the other realm reads reads as unrendered', K1R.cardUnrendered, ['ok']);
  const K3 = evaluateNested('kernelAudit', nestedShapes(K1, 'buildK'), { builtBy: 'buildK', surfaces: { expected: 'export-only', nodes: 'export-only', ok: 'card' } }, KDIR, {
    readers: [{ file: 'over.js', text: KDIR, aliasPath: 'fusion.kernelAudit' }]
  });
  ck('🔴 a realm that binds no alias still credits a direct read', K3.noAlias, false);
  ck('…and that card key is credited', K3.cardUnrendered, []);
  /* 🔴 TWO REALMS THAT BOTH BIND AN ALIAS. `K2`'s second realm reads the whole path and binds
     nothing, which is why the verdict reported `first.found` through four subtrees with nothing
     reding. `fusion.window` binds `w` in two realms, and the evidence named one of the two. */
  const KOVR = ['function over(fusion) {', '  var kb = fusion.kernelAudit || {};', '  if (kb.ok) {', '    show(kb.nodes);', '  }', '}'].join('\n');
  const K4 = evaluateNested('kernelAudit', nestedShapes(K1, 'buildK'), { builtBy: 'buildK', surfaces: { expected: 'card', nodes: 'card', ok: 'card' } }, KAPP, {
    readers: [
      { file: 'app.js', text: KAPP, aliasPath: 'FUSION.kernelAudit' },
      { file: 'over.js', text: KOVR, aliasPath: 'fusion.kernelAudit' }
    ]
  });
  ck(
    "🔴 BOTH realms' alias sites reach the verdict",
    K4.aliasSites.map((a) => a.file + ':' + a.alias),
    ['app.js:ka', 'over.js:kb']
  );
  ck('…and the label names the realm when two of them bind', aliasLabel(K4.aliasSites), 'ka@app.js:2, kb@over.js:2');
  ck('…while a one-realm subtree keeps the line it printed before', aliasLabel(K1R.aliasSites), 'ka@2');
  ck('…and a four-argument call still labels its one realm', K1R.aliasSites[0].file, 'app.js');
  /* 🔴 A NESTED DECLARATION FOR A KEY THE LITERAL DROPPED: reported, never red — the same policy as
     depth 1's `staleDeclarations`. It was computed and surfaced nowhere until 2026-11-13. */
  const KSTALE = evaluateNested('kernelAudit', nestedShapes(K1, 'buildK'), { ...K2DECL, surfaces: { ...K2DECL.surfaces, retired: 'card' } }, KAPP, {
    readers: [
      { file: 'app.js', text: KAPP, aliasPath: 'FUSION.kernelAudit' },
      { file: 'over.js', text: KDIR, aliasPath: 'fusion.kernelAudit' }
    ]
  });
  ck('🔴 a nested declaration the literal dropped is named', KSTALE.stale, ['retired']);
  ck("…and it is not a red, because the removal is the author's", nestedReasons(KSTALE).filter(Boolean), []);
  ck('…and it does not read as a card key nobody renders', KSTALE.cardUnrendered, []);
  ck('an unresolved binding carries its realm too', K4.aliasUnresolved, []);
  /* --- the INNER object layer: depth 3 of an OBJECT, not of an array --------------- */
  const STOK = (src) => ({ code: codeOnly(src), by: 'tokenizer' });
  const SSCH = [
    'function pub(fusion) {',
    '  var _exp = {',
    '    schema: {',
    '      name: BUS,',
    '      version: "1.3",',
    '      method: {',
    '        confidence: "a noisy-OR of the sources",',
    '        apneaMatch: "an asymmetric directional window"',
    '      }',
    '    }',
    '  };',
    '  return _exp;',
    '}'
  ].join('\n');
  ck('🔴 an object inside a subtree yields its own keys', innerShape(SSCH, 'schema', 'method').keys, ['apneaMatch', 'confidence']);
  ck('…and the line it names is the inner anchor', innerShape(SSCH, 'schema', 'method').at, 6);
  ck('…and the shape says which layer read it', innerShape(SSCH, 'schema', 'method').shapeKind, 'inner');
  ck('…and the parent shape still reads three keys at depth 2', inlineShape(SSCH, 'schema').union, ['method', 'name', 'version']);
  ck('an inner literal the parent does not hold is null', innerShape(SSCH, 'schema', 'tiers'), null);
  ck('…and so is an inner literal of a subtree that is absent', innerShape(SSCH, 'window', 'method'), null);
  /* 🔴 ANCHORED INSIDE THE PARENT. A same-named literal elsewhere in the file is a different
     object, and a global search would union the two into a shape no route ever emits. */
  const SOUT = 'function other() {\n  var z = {\n    method: {\n      zzz: 1\n    }\n  };\n}\n' + SSCH;
  ck('🔴 a same-named literal OUTSIDE the parent stays out of the shape', innerShape(SOUT, 'schema', 'method').keys, ['apneaMatch', 'confidence']);
  ck('…and the parent shape is unmoved by it', inlineShape(SOUT, 'schema').union, ['method', 'name', 'version']);
  /* 🔴 THE SHAPE IS READ IN PREPARED LINES, so a raw slice taken on a prepared index could cut the
     wrong lines whenever the two texts hold different line counts. Measured 2026-11-13 on both
     parse routes and both comment forms: the keys and the line agree. The parity is what the gate
     needs, and it holds because this reader never leaves prepared space. */
  const SSCHC = '/* one */\n/* two */\n' + SSCH;
  const SSCHL = '// one\n// two\n' + SSCH;
  ck('🔴 the inner keys are identical under the tokenizer route', innerShape(SSCHC, 'schema', 'method', STOK).keys, ['apneaMatch', 'confidence']);
  ck('…and the acorn route reads the same keys', innerShape(SSCHC, 'schema', 'method').keys, ['apneaMatch', 'confidence']);
  ck('…and both routes name one line, under a block-comment prefix', [innerShape(SSCHC, 'schema', 'method').at, innerShape(SSCHC, 'schema', 'method', STOK).at], [8, 8]);
  ck('…and under a line-comment prefix too', [innerShape(SSCHL, 'schema', 'method').at, innerShape(SSCHL, 'schema', 'method', STOK).at], [8, 8]);
  /* 🔴 TWO EXPORT ROUTES, AND ONE OF THEM CARRIES NO INNER OBJECT. */
  const STWO = SSCH + '\n' + SSCH.replace(/      method: \{\n.*\n.*\n      \}\n/s, '');
  ck('🔴 a parent route with no inner literal makes every inner key conditional', innerShape(STWO, 'schema', 'method').partial, ['apneaMatch', 'confidence']);
  ck('…and the reason is the route, not an undefined value', innerShape(STWO, 'schema', 'method').partialKind, 'export-route');
  const SUND = SSCH.replace('confidence: "a noisy-OR of the sources",', 'confidence: cfg ? "a noisy-OR" : undefined,');
  ck('an inner key that can evaluate to `undefined` says so', innerShape(SUND, 'schema', 'method').partial, ['confidence']);
  ck('…and names that mechanism', innerShape(SUND, 'schema', 'method').partialKind, 'undefined-value');
  const SBOTH = SUND + '\n' + SUND.replace('        apneaMatch: "an asymmetric directional window"', '        apneaMatch: "x",\n        extra: 1');
  ck(
    '🔴 TWO mechanisms at once refuse rather than report one reason for both',
    (() => {
      try {
        innerShape(SBOTH, 'schema', 'method');
        return 'no throw';
      } catch (e) {
        return /TWO different reasons/.test(e.message);
      }
    })(),
    true
  );
  /* 🔴 THE ONE-LINE LITERAL. `handshakes` writes each inner object on a single line, and the
     open-ended anchor read neither, so both keys went unjudged with nothing reporting it. The
     reader now takes that form too, and these legs pin where it stops. */
  const SONE = [
    'function pub(fusion) {',
    '  var _exp = {',
    '    handshakes: {',
    '      glucodex_ready: { glucose_autonomic_correlation: fusion.autoGly ? fusion.autoGly.r : null },',
    '      ecgdex_ready: { glucoseCorrelation: fusion.autoGly ? fusion.autoGly.r : null }',
    '    }',
    '  };',
    '  return _exp;',
    '}'
  ].join('\n');
  ck('🔴 an inner literal written on ONE line yields its key', innerShape(SONE, 'handshakes', 'glucodex_ready').keys, ['glucose_autonomic_correlation']);
  ck('…and the second one is read as its own shape', innerShape(SONE, 'handshakes', 'ecgdex_ready').keys, ['glucoseCorrelation']);
  ck('…and each names the line it sits on', [innerShape(SONE, 'handshakes', 'glucodex_ready').at, innerShape(SONE, 'handshakes', 'ecgdex_ready').at], [4, 5]);
  ck('…and the tokenizer route reads the same key', innerShape(SONE, 'handshakes', 'glucodex_ready', STOK).keys, ['glucose_autonomic_correlation']);
  ck('…and the parent still reads two keys at depth 2', inlineShape(SONE, 'handshakes').union, ['ecgdex_ready', 'glucodex_ready']);
  const SONEM = SONE.replace('{ glucoseCorrelation: fusion.autoGly ? fusion.autoGly.r : null }', '{ a: f(1, 2), b: [3, 4] }');
  ck('🔴 a comma inside a call or an array does not split a key', innerShape(SONEM, 'handshakes', 'ecgdex_ready').keys, ['a', 'b']);
  const SONEU = SONE.replace('{ glucoseCorrelation: fusion.autoGly ? fusion.autoGly.r : null }', '{ glucoseCorrelation: cfg ? 1 : undefined }');
  ck('…and a one-line key that can evaluate to `undefined` says so', innerShape(SONEU, 'handshakes', 'ecgdex_ready').partial, ['glucoseCorrelation']);
  /* 🔴 WHERE IT STOPS. A one-line body holding another literal keeps the old refusal, because a
     nested brace needs the multi-line depth walk. The gate says null rather than read half. */
  const SONEN = SONE.replace('{ glucoseCorrelation: fusion.autoGly ? fusion.autoGly.r : null }', '{ inner: { deep: 1 } }');
  ck('🔴 a one-line body holding another literal is refused, not half-read', innerShape(SONEN, 'handshakes', 'ecgdex_ready'), null);
  ck('…and the parent shape is unmoved by that refusal', inlineShape(SONEN, 'handshakes').union, ['ecgdex_ready', 'glucodex_ready']);
  const SONEO = SONE.replace('    handshakes: {', '    handshakes: { glucodex_ready: 1, ecgdex_ready: 2 },')
    .replace('      glucodex_ready: { glucose_autonomic_correlation: fusion.autoGly ? fusion.autoGly.r : null },\n', '')
    .replace('      ecgdex_ready: { glucoseCorrelation: fusion.autoGly ? fusion.autoGly.r : null }\n    }\n', '');
  ck('🔴 a one-line PARENT is read by the same path', inlineShape(SONEO, 'handshakes').union, ['ecgdex_ready', 'glucodex_ready']);
  const SRD = 'function draw(fusion) {\n  return 1;\n}';
  const SDECL = (over) => ({
    inline: true,
    aliasPath: 'fusion.schema',
    surfaces: { name: 'export-only', version: 'export-only', method: 'export-only' },
    inner: { method: { surfaces: { confidence: 'export-only', apneaMatch: 'export-only' } } },
    ...over
  });
  const sEval = (over, ishapes) =>
    evaluateNested('schema', inlineShape(SSCH, 'schema'), SDECL(over), SRD, {
      readers: [{ file: 'render.js', text: SRD, aliasPath: 'fusion.schema' }],
      innerShapes: ishapes === undefined ? { method: innerShape(SSCH, 'schema', 'method') } : ishapes
    });
  ck('🔴 a subtree whose every key is export-only passes with no reader at all', sEval({}).ok, true);
  ck(
    '…and the inner layer reports the object it judged',
    sEval({}).inners.map((i) => i.name + '{' + i.keys.length + '}'),
    ['method{2}']
  );
  ck('an undeclared inner key reds', sEval({ inner: { method: { surfaces: { confidence: 'export-only' } } } }).innerUndeclared, ['method.apneaMatch']);
  ck('…and the reason names the depth', nestedReasons(sEval({ inner: { method: { surfaces: { confidence: 'export-only' } } } }))[0].includes('inner key(s) declare no surface'), true);
  /* 🔴 A `card` LABEL AT THIS DEPTH CLAIMS A CREDIT NOBODY COMPUTED. The read machinery reaches one
     hop below an alias and nothing in it addresses `holder.schema.method.window`. */
  const SCARD = sEval({ inner: { method: { surfaces: { confidence: 'card', apneaMatch: 'export-only' } } } });
  ck("🔴 a 'card' label one level inside a subtree reds", SCARD.innerCardDeclared, ['method.confidence']);
  ck('…and the reason says the gate credits no reader there', nestedReasons(SCARD)[0].includes('credits no reader one level inside'), true);
  ck('…and it is not reported as an undeclared key', SCARD.innerUndeclared, []);
  const SBAD = sEval({ inner: { method: { surfaces: { confidence: 'rendered', apneaMatch: 'export-only' } } } });
  ck('an inner label outside the vocabulary reds', SBAD.innerBadValue, ['method.confidence']);
  /* 🔴 REPORTED, NEVER RED — the same policy depth 1 and depth 2 apply to a declaration the literal
     no longer carries: the author owns the removal, and the gate only has to say so. */
  const SSTALE = sEval({ inner: { method: { surfaces: { confidence: 'export-only', apneaMatch: 'export-only', retired: 'export-only' } } } });
  ck('🔴 an inner declaration the literal dropped is named', SSTALE.innerStale, ['method.retired']);
  ck("…and it is not a red, because the removal is the author's", nestedReasons(SSTALE).filter(Boolean), []);
  const SGRAND = [
    'function pub(fusion) {',
    '  var _exp = {',
    '    schema: {',
    '      method: {',
    '        tiers: {',
    '          device: 1,',
    '          cvhr: 0.8',
    '        }',
    '      }',
    '    }',
    '  };',
    '}'
  ].join('\n');
  const SUNK = evaluateNested(
    'schema',
    inlineShape(SGRAND, 'schema'),
    { inline: true, aliasPath: 'fusion.schema', surfaces: { method: 'export-only' }, inner: { tiers: { surfaces: { device: 'export-only', cvhr: 'export-only' } } } },
    SRD,
    {
      readers: [{ file: 'render.js', text: SRD, aliasPath: 'fusion.schema' }],
      innerShapes: { tiers: innerShape(SGRAND, 'schema', 'tiers') }
    }
  );
  ck('🔴 an inner literal that is a GRANDCHILD names itself, because the subtree does not carry it', SUNK.innerUnknown, ['tiers']);
  ck('…and that reds', SUNK.ok, false);
  ck('…and the reason says the subtree does not carry it', nestedReasons(SUNK)[0].includes('does not carry'), true);
  ck('a declared inner shape this gate could not read names itself', sEval({}, {}).innerShapeMissing, ['method']);
  ck('…and reds', sEval({}, {}).ok, false);
  ck('a subtree with NO inner block judges exactly as before', sEval({ inner: undefined }).inners, []);
  ck('…and its own key list is unmoved', sEval({ inner: undefined }).keys, ['method', 'name', 'version']);
  ck('…and it stays green', sEval({ inner: undefined }).ok, true);
  /* --- depth 3: what a reader takes out of an ELEMENT -------------------------------- */
  const E1 = [
    'function buildE(recs) {',
    '  var rows = [], bad = [];',
    '  recs.forEach(function (r) {',
    '    var entry = { node: r.n, hash: r.h, version: r.v, status: r.s };',
    '    rows.push(entry);',
    '    if (r.s !== "match") bad.push(entry);',
    '  });',
    '  return { nodes: rows, mismatches: bad, ok: bad.length === 0 };',
    '}'
  ].join('\n');
  const ESHAPE = elementShape(E1, 'buildE', 'entry');
  ck('🔴 an element literal reads its own keys from source', ESHAPE.keys, ['node', 'hash', 'version', 'status']);
  ck('…and names the line it read them on', ESHAPE.at, 4);
  ck('a moved element name refuses rather than guessing', elementShape(E1, 'buildE', 'entries'), null);
  ck('two assignments of one name are ambiguous, so it refuses', elementShape(E1.replace('rows.push(entry);', 'var entry = { node: 1 };'), 'buildE', 'entry'), null);
  ck('a multi-line element literal refuses, and is not read short', elementShape('function b(x) {\n  var e = {\n    node: 1\n  };\n  return e;\n}', 'b', 'e'), null);
  ck('an element name outside the builder is not found', elementShape('function a(x) { var e = { q: 1 }; }\nfunction b(y) { return 1; }', 'b', 'e'), null);
  /* 🔴 THE TWO BLANKING ROUTES ARE NOT INTERCHANGEABLE, AND CI ONLY EVER TAKES THE SECOND.
     `tests.yml` installs no node_modules, so `prepare` finds no acorn and falls back to the
     tokenizer, which DELETES comment lines instead of blanking them in place. Every leg below
     forces that route, because the acorn route hides the whole defect. */
  const TOK = (src) => ({ code: codeOnly(src), by: 'tokenizer' });
  const E1C = '/* one */\n/* two */\n/* three */\n' + E1;
  ck('🔴 a shifted line index does not change the keys under the tokenizer route', elementShape(E1C, 'buildE', 'entry', TOK).keys, ['node', 'hash', 'version', 'status']);
  ck('…and the line it names is the RAW line, not the blanked one', elementShape(E1C, 'buildE', 'entry', TOK).at, 7);
  ck('…while the acorn route names the same raw line', elementShape(E1C, 'buildE', 'entry').at, 7);
  const EAPP = [
    'function recompute() {',
    '  var ka = FUSION && FUSION.kernelAudit;',
    '  if (ka && ka.mismatches && ka.mismatches.length) {',
    '    ka.mismatches.forEach(function (m) {',
    '      warn(m.node + m.hash);',
    '    });',
    '  }',
    '}'
  ].join('\n');
  /* 🔴 THE SPLIT CHAIN. OverDex writes the array on one line and `.map(` on the next, and a
     per-line regex reported this site as absent. */
  const EOVER = [
    'function draw(fusion) {',
    '  if (!fusion.kernelAudit.ok) {',
    '    out(',
    '      fusion.kernelAudit.mismatches',
    '        .map(function (m) {',
    "          return m.node + ' ' + m['status'];",
    '        })',
    '        .join()',
    '    );',
    '  }',
    '}'
  ].join('\n');
  const EAS = aliasSites(EAPP, 'FUSION.kernelAudit').sites;
  const ESITES = elementCallbacks(EAPP, ['FUSION.kernelAudit'].concat(EAS.map((s) => s.alias)), 'mismatches');
  ck('an element callback behind an alias is found', ESITES.length, 1);
  ck('…and the parameter it binds names one element', ESITES[0].param, 'm');
  ck('…with the iterator named', ESITES[0].iterator, 'forEach');
  const EOSITES = elementCallbacks(EOVER, ['fusion.kernelAudit'], 'mismatches');
  ck('🔴 a member chain split across lines is still one site', EOSITES.length, 1);
  ck('…and its prefix is the whole path', EOSITES[0].prefix, 'fusion.kernelAudit');
  ck('a prefix no realm declares credits nothing', elementCallbacks(EAPP, ['OTHER.kernelAudit'], 'mismatches').length, 0);
  ck('an element read off the parameter counts', !!readsElementKey(EAPP, ESITES, 'node'), true);
  ck('…in bracket form too', !!readsElementKey(EOVER, EOSITES, 'status'), true);
  ck('…and a key the callback never reads stays unread', !!readsElementKey(EAPP, ESITES, 'version'), false);
  ck('…while a longer identifier is not that key', !!readsElementKey(EAPP, ESITES, 'nod'), false);
  ck('an arrow callback binds its element the same way', elementCallbacks('var x = a.kernelAudit.mismatches.map((m) => m.node);', ['a.kernelAudit'], 'mismatches').length, 1);
  const EOVERC = '/* a */\n/* b */\n' + EOVER;
  const EOTOK = elementCallbacks(EOVERC, ['fusion.kernelAudit'], 'mismatches', TOK);
  ck('🔴 a site pairs across the blanked and the raw text', [EOTOK.length, EOTOK[0].rawFrom !== null], [1, true]);
  ck('…and its reported line is the RAW line', EOTOK[0].rawLine, 7);
  ck('…so a bracket read is credited under the tokenizer route too', !!readsElementKey(EOVERC, EOTOK, 'status', TOK), true);
  const EOCMT = EOVER + '\n/* fusion.kernelAudit.mismatches.map(m) */';
  ck('🔴 a comment naming the same chain breaks the pairing, and the site says so', elementCallbacks(EOCMT, ['fusion.kernelAudit'], 'mismatches', TOK)[0].rawFrom, null);

  /* 🔴 A PUSH-SITE ELEMENT LITERAL, THE SECOND ELEMENT SHAPE THIS GATE CAN READ. `detectClockSkew`
     pushes a multi-line literal into `findings[]` at two sites with DIFFERENT key lists, and both
     sites sit inside a `.forEach` callback — so this reader is scoped by the array name, and a
     union over sites marks the difference partial. */
  const P1 = [
    'function detectSkew(recs) {',
    '  var findings = [];',
    '  recs.forEach(function (r) {',
    '    findings.push({',
    '      node: r.n,',
    '      offsetSec: r.o,',
    '      method: "pairwise"',
    '    });',
    '  });',
    '  (recs || []).forEach(function (r) {',
    '    findings.push({',
    '      node: r.n,',
    '      offsetSec: r.o,',
    '      method: "rtc",',
    '      source: "rtc-readback"',
    '    });',
    '  });',
    '  return { findings: findings };',
    '}'
  ].join('\n');
  const PSH = pushShapes(P1, 'detectSkew', 'findings');
  ck('a push-site element literal unions its keys over every site', PSH.keys, ['method', 'node', 'offsetSec', 'source']);
  ck('🔴 …and a key only one site writes is PARTIAL', PSH.partial, ['source']);
  ck('…every push line is named', PSH.siteAt, [4, 11]);
  ck('…and `at` is the first of them', PSH.at, 4);
  ck('🔴 a push inside a nested callback IS the builder element shape, unlike a return', PSH.keys.length, 4);
  ck('a one-line push literal reads too', pushShapes('function b(x) {\n  var out = [];\n  out.push({ a: 1, b: 2 });\n  return out;\n}', 'b', 'out').keys, ['a', 'b']);
  ck('a literal that never closes refuses, and is not read short', pushShapes('function b(x) {\n  var out = [];\n  out.push({\n    a: 1,\n', 'b', 'out'), null);
  ck('a builder this file does not hold refuses', pushShapes(P1, 'detectOther', 'findings'), null);
  ck('an array the builder never pushes refuses', pushShapes(P1, 'detectSkew', 'pairs'), null);
  ck(
    '🔴 a SECOND declaration of the array name refuses rather than mixing two arrays',
    pushShapes(P1.replace('  (recs || []).forEach(function (r) {', '  var findings = [];\n  (recs || []).forEach(function (r) {'), 'detectSkew', 'findings'),
    null
  );

  /* 🔴 THE INDEXED FORM, which `callbackSites` cannot see. The census reported ONE unjudged element
     read where three array keys are read element-wise, because two of them use an index. */
  const I1 = [
    'function lines(cs) {',
    '  var out = [];',
    '  var vetoes = cs.vetoes || [];',
    '  for (var i = 0; i < vetoes.length; i++) {',
    '    var v = vetoes[i] || {};',
    '    out.push(v.note);',
    '  }',
    '  return out;',
    '}'
  ].join('\n');
  ck('an indexed element read through a local array alias is found', indexedSites(I1, ['cs'], 'vetoes').length, 1);
  ck('…and it names the line of the ELEMENT read, not of the binding', indexedSites(I1, ['cs'], 'vetoes')[0].elemLine, 5);
  ck('…with the binding line beside it', indexedSites(I1, ['cs'], 'vetoes')[0].line, 3);
  ck('a prefix no realm declares credits nothing', indexedSites(I1, ['other'], 'vetoes').length, 0);
  ck('a bind with no indexed read credits nothing', indexedSites('function f(cs) {\n  var v = cs.vetoes || [];\n  return v.length;\n}', ['cs'], 'vetoes').length, 0);
  ck(
    '🔴 an indexed read in ANOTHER function is not that binding element read',
    indexedSites('function a(cs) {\n  var v = cs.vetoes || [];\n  return v.length;\n}\nfunction b(q) {\n  return v[0];\n}', ['cs'], 'vetoes').length,
    0
  );
  /* 🔴 DISCOVERY RUNS ON BLANKED TEXT, so a commented-out index read cannot credit one, and the
     line a human reads still comes from the raw text. This is board 6051 applied to the new form. */
  const I1C = '/* one */\n/* two */\n' + I1;
  ck('🔴 a commented-out indexed read credits nothing', indexedSites('function f(cs) {\n  var v = cs.vetoes || [];\n  // v[0] is the first veto\n  return v.length;\n}', ['cs'], 'vetoes').length, 0);
  ck('🔴 the element line is the RAW line under the tokenizer route', indexedSites(I1C, ['cs'], 'vetoes', TOK)[0].rawElemLine, 7);
  ck('…and the acorn route names the same raw line', indexedSites(I1C, ['cs'], 'vetoes')[0].rawElemLine, 7);
  ck(
    '🔴 a comment naming the same binding breaks the pairing, and the site says so',
    indexedSites(I1.replace('function lines(cs) {', 'function lines(cs) {\n  /* var vetoes = cs.vetoes, then vetoes[k] */'), ['cs'], 'vetoes', TOK)[0].rawElemLine,
    null
  );
  const EMPTYN = { undeclared: [], badValue: [], cardUnrendered: [], exportOnlyRead: [], undeclaredPartial: [], stalePartial: [] };
  ck(
    '…and an unpaired site reds with a named reason',
    nestedReasons(Object.assign({}, EMPTYN, { elemRawUnpaired: ['overdex-app.js:7 (mismatches)'] }))[0],
    '1 element read site(s) do not pair across the blanked and raw text, so a bracket read cannot be judged there: overdex-app.js:7 (mismatches)'
  );
  const EDECL = (over) => ({
    builtBy: 'buildE',
    surfaces: { nodes: 'export-only', mismatches: 'card', ok: 'card' },
    elements: { entry: { servesKeys: ['nodes', 'mismatches'], surfaces: { node: 'card', hash: 'card', status: 'card', version: 'export-only' } } },
    ...over
  });
  const E3 = (over, elems) =>
    evaluateNested('kernelAudit', nestedShapes(E1, 'buildE'), EDECL(over), EAPP, {
      readers: [
        { file: 'app.js', text: EAPP, aliasPath: 'FUSION.kernelAudit' },
        { file: 'over.js', text: EOVER, aliasPath: 'fusion.kernelAudit' }
      ],
      elementShapes: elems === undefined ? { entry: ESHAPE } : elems
    });
  ck('🔴 three element keys are card over two realms, and none is unread', E3().elemCardUnread, []);
  ck('…the per-realm element count names which realm credited which key', E3().elements[0].cardByReader, { 'app.js': 2, 'over.js': 1 });
  ck('…one shape serves BOTH array keys', E3().elements[0].serves, ['nodes', 'mismatches']);
  ck('…and the subtree is ok', E3().ok, true);
  ck(
    "🔴 an element key declared 'card' that no realm reads reds",
    E3({ elements: { entry: { servesKeys: ['mismatches'], surfaces: { node: 'card', hash: 'card', status: 'card', version: 'card' } } } }).elemCardUnread,
    ['entry.version']
  );
  ck(
    "🔴 an element key declared 'export-only' that a realm reads reds",
    E3({ elements: { entry: { servesKeys: ['mismatches'], surfaces: { node: 'card', hash: 'card', status: 'export-only', version: 'export-only' } } } }).elemExportOnlyRead,
    ['entry.status']
  );
  const E1REALM = evaluateNested('kernelAudit', nestedShapes(E1, 'buildE'), EDECL(), EAPP, {
    readers: [{ file: 'app.js', text: EAPP, aliasPath: 'FUSION.kernelAudit' }],
    elementShapes: { entry: ESHAPE }
  });
  ck('🔴 drop the second realm and the key only it reads is unread', E1REALM.elemCardUnread, ['entry.status']);
  ck(
    'a declared element key absent from the literal is reported',
    E3({ elements: { entry: { servesKeys: ['mismatches'], surfaces: { node: 'card', hash: 'card', status: 'card', version: 'export-only', kind: 'card' } } } }).elemUndeclared,
    ['entry.kind (declared, absent from the literal)']
  );
  ck('an element key with no surface at all is reported', E3({ elements: { entry: { servesKeys: ['mismatches'], surfaces: { node: 'card', hash: 'card', status: 'card' } } } }).elemUndeclared, [
    'entry.version'
  ]);
  ck(
    'an element surface outside the two words reds',
    E3({ elements: { entry: { servesKeys: ['mismatches'], surfaces: { node: 'rendered', hash: 'card', status: 'card', version: 'export-only' } } } }).elemBadValue,
    ['entry.node']
  );
  ck(
    '🔴 a servesKeys entry the subtree does not carry names itself',
    E3({ elements: { entry: { servesKeys: ['mismatches', 'widgets'], surfaces: { node: 'card', hash: 'card', status: 'card', version: 'export-only' } } } }).elemServesUnknown,
    ['entry serves widgets']
  );
  ck('a declared shape this gate could not read is reported, not assumed', E3({}, {}).elemShapeMissing, ['entry']);
  ck('…and that alone is not ok', E3({}, {}).ok, false);
  /* 🔴 THE CENSUS. A subtree with no `elements` block is judged exactly as before, and every
     element read it does not judge is COUNTED rather than passed over in silence. */
  const ENONE = E3({ elements: undefined });
  ck('🔴 no elements block leaves the subtree judged as before', ENONE.ok, true);
  ck('…with no element shape', ENONE.elements, []);
  ck('…and the unjudged element reads counted in both realms', ENONE.elemUnjudged.length, 2);
  /* 🔴 AND THE INDEXED FORM IS COUNTED TOO. A reader that walks an array by index reads its
     elements exactly as a callback does, and the census missed `vetoes[]` and `seamCensus[]` in
     the live subtree for that reason alone. */
  const EIDX = 'function draw() {\n  var ns = FUSION.kernelAudit.nodes || [];\n  for (var i = 0; i < ns.length; i++) {\n    var n = ns[i] || {};\n    paint(n.node);\n  }\n}';
  const EIDXR = (over) =>
    evaluateNested('kernelAudit', nestedShapes(E1, 'buildE'), EDECL(over), EIDX, {
      readers: [{ file: 'idx.js', text: EIDX, aliasPath: 'FUSION.kernelAudit' }],
      elementShapes: {}
    });
  ck('🔴 an indexed element read with no declaration is COUNTED, not passed over', EIDXR({ elements: undefined }).elemUnjudged.length, 1);
  ck('…naming the array key and the element line', [EIDXR({ elements: undefined }).elemUnjudged[0].arrayKey, EIDXR({ elements: undefined }).elemUnjudged[0].line], ['nodes', 4]);
  ck('…and the form it was read in', EIDXR({ elements: undefined }).elemUnjudged[0].via, 'index');
  ck(
    '…while a declaration that serves that key takes it out of the census',
    EIDXR({ elements: { entry: { servesKeys: ['nodes'], surfaces: { node: 'card', hash: 'card', status: 'card', version: 'export-only' } } } }).elemUnjudged.length,
    0
  );
  ck(
    '…each naming its own file and array key',
    ENONE.elemUnjudged.map((u) => u.file + ':' + u.arrayKey),
    ['app.js:mismatches', 'over.js:mismatches']
  );
  ck('a declared shape leaves no unjudged read behind', E3().elemUnjudged, []);
  /* ── THE `.map` RETURN LITERAL, AND THE BOUND INDEXED ELEMENT ─────────────────────────────────
     🔴 `vetoes` and `seamCensus` are built by a `.map` return literal, which neither `elementShape`
     nor `pushShapes` can read, and they are READ through indexed loops, which `elementCallbacks`
     cannot see. Both halves are planted here. */
  const M1 = [
    'function build(recs) {',
    '  var out = (recs || [])',
    '    .filter(function (r) {',
    '      return r && r.ok === true;',
    '    })',
    '    .map(function (r) {',
    '      return {',
    '        node: r.node,',
    '        hash: r.hash',
    '      };',
    '    });',
    '  return out;',
    '}'
  ].join('\n');
  ck('a `.map` return literal reads as an element shape', mapShapes(M1, 'build', 'out').keys, ['hash', 'node']);
  ck('…naming the literal line, not the map line', mapShapes(M1, 'build', 'out').at, 7);
  ck('…and the route it came from', mapShapes(M1, 'build', 'out').sites[0].via, 'map');
  ck('a one-line return literal reads too', mapShapes('function b(r) {\n  var o = (r || []).map(function (x) {\n    return { a: 1, b: 2 };\n  });\n  return o;\n}', 'b', 'o').keys, ['a', 'b']);
  /* 🔴 THE `.filter` CALLBACK BESIDE IT ALSO HOLDS A `return`, so the first return in the statement
     is NOT the element literal. This fixture puts an object literal in the filter. */
  const M1F = M1.replace('      return r && r.ok === true;', '      return {\n        bogus: 1\n      }.bogus;');
  ck('🔴 the literal is taken from after the map line, never from the filter beside it', mapShapes(M1F, 'build', 'out').keys, ['hash', 'node']);
  ck('a builder this file does not hold refuses', mapShapes(M1, 'other', 'out'), null);
  ck('an array the builder does not declare refuses', mapShapes(M1, 'build', 'other'), null);
  ck('a second declaration of the array name refuses', mapShapes(M1.replace('  var out = (recs || [])', '  var out = [];\n  var out = (recs || [])'), 'build', 'out'), null);
  ck('a statement with no map refuses', mapShapes('function b(r) {\n  var o = (r || []).slice();\n  return o;\n}', 'b', 'o'), null);
  ck('a statement with TWO maps is ambiguous and refuses', mapShapes('function b(r) {\n  var o = (r || []).map(f).map(function (x) {\n    return { a: 1 };\n  });\n  return o;\n}', 'b', 'o'), null);
  ck(
    'a literal that never closes refuses, and is not read short',
    mapShapes('function b(r) {\n  var o = (r || []).map(function (x) {\n    return {\n      a: 1\n  });\n  return o;\n}', 'b', 'o'),
    null
  );
  /* One element out of several routes. The union is the shape, and `partial` is what one route
     omits — the same word depth 2 uses for a key missing from some return shape. */
  const MG = mergeShapes([
    { at: 1, keys: ['a', 'b'], via: 'map' },
    { at: 5, keys: ['b', 'c'], via: 'push' }
  ]);
  ck('a merged shape unions its routes', MG.keys, ['a', 'b', 'c']);
  ck('…and names the keys one route omits', MG.partial, ['a', 'c']);
  ck('…with every build line', MG.siteAt, [1, 5]);
  ck(
    '…and each route named',
    MG.sites.map((x) => x.via),
    ['map', 'push']
  );
  ck('no route at all is no shape', mergeShapes([]), null);
  /* The bound indexed element. A callback carries its element in a parameter; an indexed loop
     carries it in a local binding, and the scope is the loop BODY. */
  const IE1 = [
    'function lines(cs) {',
    '  var out = [];',
    '  var vs = cs.vetoes || [];',
    '  for (var i = 0; i < vs.length; i++) {',
    '    var v = vs[i] || {};',
    '    out.push(v.note + (v.node || "?"));',
    '  }',
    '  out.push(v.seams);',
    '  return out;',
    '}'
  ].join('\n');
  const IES = indexedElements(IE1, ['cs'], 'vetoes');
  ck('an indexed loop binds its element', IES.length, 1);
  ck('…naming the binding as the element parameter', IES[0].param, 'v');
  ck('…at the line the element is bound', IES[0].line, 5);
  ck('🔴 a key read off the bound element is CREDITED', !!readsElementKey(IE1, IES, 'note'), true);
  ck('…and a second key on the same element too', !!readsElementKey(IE1, IES, 'node'), true);
  ck('🔴 a read AFTER the loop body credits nothing — the scope is the body', readsElementKey(IE1, IES, 'seams'), null);
  const IEB = IE1.replace('v.note', "v['note']");
  ck('the bracket form is credited off the RAW text', !!readsElementKey(IEB, indexedElements(IEB, ['cs'], 'vetoes'), 'note'), true);
  ck('a prefix no realm declares binds nothing', indexedElements(IE1, ['other'], 'vetoes').length, 0);
  ck('🔴 a commented-out element binding credits nothing', indexedElements(IE1.replace('    var v = vs[i] || {};', '    // var v = vs[i] || {};'), ['cs'], 'vetoes').length, 0);
  ck(
    'a loop body that never closes is refused, not scoped to the function',
    indexedElements('function f(cs) {\n  var vs = cs.vetoes || [];\n  for (var i = 0; i < vs.length; i++) {\n    var v = vs[i] || {};\n', ['cs'], 'vetoes').length,
    0
  );
  const IE1C = '/* one */\n/* two */\n' + IE1;
  ck('🔴 the element line is the RAW line under the tokenizer route', indexedElements(IE1C, ['cs'], 'vetoes', TOK)[0].rawLine, 7);
  ck('…and the acorn route names the same raw line', indexedElements(IE1C, ['cs'], 'vetoes')[0].rawLine, 7);
  /* The integration: a key declared `card` and read THROUGH AN INDEX is credited, and the
     export-only test fires on the same read. Both directions, planted. */
  const ESHP = { entry: { at: 1, keys: ['node', 'hash'], siteAt: [1], sites: [{ at: 1, keys: ['hash', 'node'], via: 'push' }], partial: [] } };
  const EIDXD = (surf) =>
    evaluateNested('kernelAudit', nestedShapes(E1, 'buildE'), EDECL({ elements: { entry: { servesKeys: ['nodes'], surfaces: surf } } }), EIDX, {
      readers: [{ file: 'idx.js', text: EIDX, aliasPath: 'FUSION.kernelAudit' }],
      elementShapes: ESHP
    });
  ck("🔴 a 'card' key read through an INDEX is credited", EIDXD({ node: 'card', hash: 'export-only' }).elemCardUnread, []);
  ck('…and that leaves no unjudged read behind', EIDXD({ node: 'card', hash: 'export-only' }).elemUnjudged, []);
  ck("🔴 …while 'export-only' on the same read reds", EIDXD({ node: 'export-only', hash: 'export-only' }).elemExportOnlyRead, ['entry.node']);
  ck("…and a 'card' key the loop never reads reds", EIDXD({ node: 'card', hash: 'card' }).elemCardUnread, ['entry.hash']);
  /* 🔴 AN ALIAS CREDITS ONLY INSIDE ITS OWN SCOPE, at depth 3 as at depth 2. */
  const EFAR = [
    'function bind() {',
    '  var ka = FUSION && FUSION.kernelAudit;',
    '  use(ka.ok);',
    '}',
    'function other() {',
    '  ka.mismatches.forEach(function (m) {',
    '    warn(m.node);',
    '  });',
    '}'
  ].join('\n');
  const EFARS = elementCallbacks(EFAR, ['FUSION.kernelAudit', 'ka'], 'mismatches');
  ck('an element callback outside the binding scope is found by text', EFARS.length, 1);
  ck(
    '…and the scope filter is what refuses it',
    aliasSites(EFAR, 'FUSION.kernelAudit').sites.some((u) => EFARS[0].line >= u.from + 1 && EFARS[0].line <= u.to + 1),
    false
  );

  /* 🔴 THE WALK FROM THE ARRAY TO ITS ITERATOR — the state that credited 2 of 11 keys until today.
     Each leg is one shape the old adjacent anchor could not see, or one the walk must refuse. */
  const W = (src, key = 'findings') => elementCallbacks(src, ['fusion'], key);
  ck('a `|| []` default guard still binds the element', W('(fusion.findings || []).forEach(function (f) { use(f.tMs); });').length, 1);
  ck('…and the site records that it crossed a guard', W('(fusion.findings || []).forEach(function (f) { use(f.tMs); });')[0].guarded, true);
  ck('a `?? []` guard binds it the same way', W('(fusion.findings ?? []).forEach(function (f) { use(f.tMs); });').length, 1);
  ck('a chained `.slice()` is crossed', W('fusion.findings.slice(0, 12).forEach(function (f) { use(f.note); });').length, 1);
  ck('…and the chain is named on the site', W('fusion.findings.slice(0, 12).forEach(function (f) { use(f.note); });')[0].chain, ['slice']);
  ck(
    'a key IS read through that chain',
    readsElementKey('fusion.findings.slice(0, 12).forEach(function (f) { use(f.note); });', W('fusion.findings.slice(0, 12).forEach(function (f) { use(f.note); });'), 'note') !== null,
    true
  );
  /* 🔴 AN ITERATOR CAN ALSO BE A LINK, so a filter in front of a forEach gives TWO sites. */
  ck('`.filter().forEach()` holds two element read sites', W('fusion.findings.filter(function (a) { return a.type; }).forEach(function (b) { use(b.note); });').length, 2);
  /* 🔴 AND `map` IS NOT A LINK, because it changes what the next callback receives. */
  ck('a chained `.map()` is the site and the walk stops there', W('fusion.findings.map(function (a) { return a.tMs; }).forEach(function (n) { use(n); });').length, 1);
  ck('an unknown chain link stops the walk', W('fusion.findings.pluck("tMs").forEach(function (f) { use(f); });').length, 0);
  ck('a guard over a NON-empty literal is not the guard form', W('(fusion.findings || [1]).forEach(function (f) { use(f.tMs); });').length, 0);
  ck('a member read with no iterator at all is not a site', W('var n = fusion.findings.length;').length, 0);
  ck('a longer key name is not this key', W('fusion.findingsExtra.forEach(function (f) { use(f.tMs); });').length, 0);

  /* 🔴 THE THIRD SHAPE SOURCE. A top-level export array's element shape lives in the export
     literal, and every refusal below is a state in which the gate must not guess. */
  const XL = (entry) => ['  var _exp = {', '    before: 1,', entry, '    after: 2', '  };'].join('\n');
  const XOK = XL(['    findings: fusion.findings.map(function (f) {', '      return {', '        tMs: f.tMs,', '        note: f.note', '      };', '    }),'].join('\n'));
  ck('the export-map reader takes the return literal of the single map', (exportMapShape(XOK, 'findings') || {}).keys, ['note', 'tMs']);
  ck('…and says the route it read', (exportMapShape(XOK, 'findings') || {}).sites[0].via, 'export-map');
  ck('an entry that is not there refuses', exportMapShape(XOK, 'absent'), null);
  ck('an entry with no map refuses', exportMapShape(XL('    findings: fusion.findings,'), 'findings'), null);
  ck(
    'an entry with TWO maps refuses rather than choosing',
    exportMapShape(
      XL(['    findings: fusion.a.map(function (x) {', '      return { p: x.p };', '    }).concat(fusion.b.map(function (y) {', '      return { q: y.q };', '    })),'].join('\n')),
      'findings'
    ),
    null
  );
  ck('a DOUBLED entry refuses', exportMapShape(XL(['    findings: fusion.findings.map(function (f) {', '      return { tMs: f.tMs };', '    }),', '    findings: 2,'].join('\n')), 'findings'), null);
  ck('a second export literal refuses', exportMapShape(XOK + '\n' + XOK, 'findings'), null);
  ck('no export literal at all refuses', exportMapShape('var other = { findings: 1 };', 'findings'), null);
  ck('a one-line return literal is read', (exportMapShape(XL('    findings: fusion.findings.map(function (f) { return { tMs: f.tMs }; }),'), 'findings') || {}).keys, ['tMs']);

  /* 🔴 AN ALIAS MUST BIND THE PATH AND THEN STOP. `var cs = FUSION && FUSION.clockSkew` names the
     subtree and NOT `FUSION`, and the gate credited a `cs.findings` read against the top-level
     `findings` array until this leg was written. */
  const AB = 'function f() {\n  var cs = FUSION && FUSION.clockSkew;\n  use(cs.seams);\n}';
  ck('a binding one level down is NOT an alias of the parent', aliasSites(AB, 'FUSION').sites.length, 0);
  ck(
    '…and IS an alias of the path it actually binds',
    aliasSites(AB, 'FUSION.clockSkew').sites.map((s) => s.alias),
    ['cs']
  );
  ck(
    'a plain binding is still an alias',
    aliasSites('function f() {\n  var x = fusion;\n  use(x.a);\n}', 'fusion').sites.map((s) => s.alias),
    ['x']
  );
  ck(
    'a `|| {}` fallback binding is still an alias',
    aliasSites('function f() {\n  var x = fusion.apnea || {};\n  use(x.a);\n}', 'fusion.apnea').sites.map((s) => s.alias),
    ['x']
  );
  ck('a TERNARY binding is not read as an alias', aliasSites('function f() {\n  var r = fusion && fusion.findings ? fusion.findings : [];\n  use(r);\n}', 'fusion').sites.length, 0);
  ck('an indexed binding is not an alias of the array', aliasSites('function f() {\n  var e = fusion.findings[0];\n  use(e.tMs);\n}', 'fusion.findings').sites.length, 0);
  /* 🔴 THE FOURTH SHAPE SOURCE — TWO EXPORT ROUTES OF DIFFERENT FORMS (`apneaTyping`). Route one is
     a producer's returned VARIABLE, route two a GUARDED literal in the slim projection. Each leg
     below is a state the readers must name rather than guess at, and the parity legs hold both
     parse routes to the same answer. */
  const ATOK = (src) => ({ code: codeOnly(src), by: 'tokenizer' });
  const ATG = [
    'var _exp = {',
    '  apneaTyping: fusion.apneaTyping',
    '    ? {',
    '        obstructive: fusion.apneaTyping.obstructive,',
    '        total: fusion.apneaTyping.total,',
    '        usable: fusion.apneaTyping.usable',
    '      }',
    '    : null,',
    '  other: 1',
    '};'
  ].join('\n');
  ck('🔴 a GUARDED literal has a shape, where `inlineShape` found no anchor at all', guardedShape(ATG, 'apneaTyping').union, ['obstructive', 'total', 'usable']);
  ck('…and the site it names is the KEY line, not the brace one line down', guardedShape(ATG, 'apneaTyping').at, 2);
  ck('…and the shape says which reader read it', guardedShape(ATG, 'apneaTyping').shapeKind, 'guarded');
  ck('…while `inlineShape` still reports nothing for that key', inlineShape(ATG, 'apneaTyping'), null);
  ck('…and one literal leaves no key conditional', guardedShape(ATG, 'apneaTyping').partial, []);
  ck('🔴 a guard whose ALTERNATIVE is a second literal refuses — one key, two key lists', guardedShape(ATG.replace('    : null,', '    : { fallback: 1 },'), 'apneaTyping'), null);
  ck('…and a consequent that never closes refuses too', guardedShape('var _exp = {\n  k: c\n    ? {\n        a: 1,\n', 'k'), null);
  ck('a literal that opens on the key own line is NOT guarded', guardedShape('x = {\n  k: {\n    a: 1\n  }\n};', 'k'), null);
  const ATG2 = ATG.replace('  other: 1', '  apneaTyping: slim.apneaTyping\n    ? {\n        obstructive: 1,\n        total: 2\n      }\n    : null');
  ck('two guarded sites union their keys', guardedShape(ATG2, 'apneaTyping').union, ['obstructive', 'total', 'usable']);
  ck('…and the key one site omits is partial, by export route', guardedShape(ATG2, 'apneaTyping').partial, ['usable']);
  ck('…which names the mechanism', guardedShape(ATG2, 'apneaTyping').partialKind, 'export-route');
  const ATGU = ATG.replace('        usable: fusion.apneaTyping.usable', '        usable: fusion.apneaTyping.usable ? true : undefined');
  ck('a guarded key whose VALUE can be undefined wears the other mechanism', guardedShape(ATGU, 'apneaTyping').partialKind, 'undefined-value');
  ck('…and names that key', guardedShape(ATGU, 'apneaTyping').partial, ['usable']);
  let ATTWO = 'no throw';
  try {
    guardedShape(ATG2.replace('        usable: fusion.apneaTyping.usable', '        usable: x ? 1 : undefined'), 'apneaTyping');
  } catch (e) {
    ATTWO = /TWO different reasons/.test(e.message) ? 'named both' : e.message;
  }
  ck('…and TWO mechanisms at once throw rather than wear one word', ATTWO, 'named both');
  ck(
    '🔴 the guarded reader answers the same on both parse routes — a block comment above the key',
    guardedShape('/* note */\n' + ATG, 'apneaTyping').union,
    guardedShape('/* note */\n' + ATG, 'apneaTyping', ATOK).union
  );
  ck('…and names the same line on both', guardedShape('/* note */\n' + ATG, 'apneaTyping').at, guardedShape('/* note */\n' + ATG, 'apneaTyping', ATOK).at);
  ck('…and the same holds for a line comment', guardedShape('// note\n' + ATG, 'apneaTyping').union, guardedShape('// note\n' + ATG, 'apneaTyping', ATOK).union);
  ck('…line by line as well', guardedShape('// note\n' + ATG, 'apneaTyping').at, guardedShape('// note\n' + ATG, 'apneaTyping', ATOK).at);

  /* 🔴 THE WHOLE GUARD ON ONE LINE. The slim export writes `kernel` that way, and the two-line
     anchor above reads nothing there. These fix the one-line form and both of its refusals. */
  const GONE = ['var _exp = {', '  kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,', '  other: 1', '};'].join('\n');
  ck('🔴 a guard that opens AND closes on one line has a shape', guardedShape(GONE, 'kernel').union, ['hash', 'version']);
  ck('…and it names the key line', guardedShape(GONE, 'kernel').at, 2);
  ck('…and the same reader claims it', guardedShape(GONE, 'kernel').shapeKind, 'guarded');
  ck('…and one site leaves no key conditional', guardedShape(GONE, 'kernel').partial, []);
  ck('…and the tokenizer route reads the same keys', guardedShape('/* note */\n' + GONE, 'kernel').union, guardedShape('/* note */\n' + GONE, 'kernel', ATOK).union);
  ck('…at the same line', guardedShape('/* note */\n' + GONE, 'kernel').at, guardedShape('/* note */\n' + GONE, 'kernel', ATOK).at);
  ck('🔴 a one-line guard whose ALTERNATIVE is a literal refuses, as the multi-line form does', guardedShape(GONE.replace(' : null,', ' : { fallback: 1 },'), 'kernel'), null);
  ck('🔴 a one-line consequent holding a NESTED literal refuses — this reader must not guess', guardedShape(GONE.replace('hash: DexKernel.HASH', 'hash: { short: 1 }'), 'kernel'), null);
  ck(
    'a one-line guarded value that can be undefined wears that mechanism',
    guardedShape(GONE.replace('version: DexKernel.VERSION', 'version: x ? 1 : undefined'), 'kernel').partialKind,
    'undefined-value'
  );
  ck('…and names that key alone', guardedShape(GONE.replace('version: DexKernel.VERSION', 'version: x ? 1 : undefined'), 'kernel').partial, ['version']);
  const GONE2 = ['var _exp = {', '  kernel: g ? { version: 1, hash: 2 } : null', '};', 'var _two = {', '  kernel: g', '    ? {', '        version: 3', '      }', '    : null', '};'].join('\n');
  ck('a one-line site and a multi-line site of one key union their keys', guardedShape(GONE2, 'kernel').union, ['hash', 'version']);
  ck('…and the key one site omits is partial by export route', guardedShape(GONE2, 'kernel').partial, ['hash']);
  ck('an UNGUARDED one-line literal is not guarded — `inlineShape` owns it', guardedShape('var _exp = {\n  kernel: { version: 1 }\n};', 'kernel'), null);

  const ATV = [
    'function typeIt(recs) {',
    '  if (!recs.length) return null;',
    '  var out = {',
    '    alpha: null,',
    '    beta: 0,',
    '    events: []',
    '  };',
    '  recs.forEach(function (r) {',
    '    out.beta++;',
    '  });',
    '  return out;',
    '}'
  ].join('\n');
  ck('🔴 a producer that returns a VARIABLE has a shape, where `nestedShapes` wanted a literal', returnVarShape(ATV, 'typeIt', 'out').union, ['alpha', 'beta', 'events']);
  ck('…and `nestedShapes` still reports nothing for it', nestedShapes(ATV, 'typeIt'), null);
  ck('…the site is the literal line', returnVarShape(ATV, 'typeIt', 'out').at, 3);
  ck('…and the reader says so', returnVarShape(ATV, 'typeIt', 'out').shapeKind, 'return-var');
  ck('…a `++` on a key the literal carries is arithmetic, not a new key', returnVarShape(ATV, 'typeIt', 'out').union.length, 3);
  ck('a function that is not there refuses', returnVarShape(ATV, 'typeNothing', 'out'), null);
  ck('a variable that is not declared there refuses', returnVarShape(ATV, 'typeIt', 'nope'), null);
  ck('a SHADOWED declaration refuses — two literals, one name', returnVarShape(ATV.replace('  recs.forEach', '  var out = {\n    gamma: 1\n  };\n  recs.forEach'), 'typeIt', 'out'), null);
  ck('a literal nobody returns refuses', returnVarShape(ATV.replace('  return out;', '  return 1;'), 'typeIt', 'out'), null);
  ck('a `const` declaration reads the same', returnVarShape(ATV.replace('  var out = {', '  const out = {'), 'typeIt', 'out').union, ['alpha', 'beta', 'events']);
  let ATADD = 'no throw';
  try {
    returnVarShape(ATV.replace('    out.beta++;', '    out.gamma = 1;'), 'typeIt', 'out');
  } catch (e) {
    ATADD = /adds gamma/.test(e.message) ? 'named the added key' : e.message;
  }
  ck('🔴 a key ADDED after the literal throws — a short key list is the one wrong answer', ATADD, 'named the added key');

  const ATROUTES = [{ returnVar: { fn: 'typeIt', via: 'out' } }, { guarded: 'apneaTyping' }];
  const ATSRC = ATV + '\n' + ATG;
  ck('🔴 two routes of different FORMS union into one surface', routeShapes(ATSRC, ATROUTES).union, ['alpha', 'beta', 'events', 'obstructive', 'total', 'usable']);
  ck('…and every key one route omits is partial', routeShapes(ATSRC, ATROUTES).partial, ['alpha', 'beta', 'events', 'obstructive', 'total', 'usable']);
  ck('…named as an export-route difference', routeShapes(ATSRC, ATROUTES).partialKind, 'export-route');
  ck('…and the shape says it came from a route list', routeShapes(ATSRC, ATROUTES).shapeKind, 'routes');
  ck(
    '…each route reports its own form',
    routeShapes(ATSRC, ATROUTES).routes.map((r) => r.via),
    ['returnVar', 'guarded']
  );
  ck(
    '…and its own site',
    routeShapes(ATSRC, ATROUTES).routes.map((r) => r.at),
    [3, 14]
  );
  ck('a route whose source is absent names ITSELF, so the author reads one route and not all of them', routeShapes(ATSRC, [{ guarded: 'noSuchKey' }]).failed, 'guarded `noSuchKey`');
  ck('…and a named function that moved does the same', routeShapes(ATSRC, [{ returnVar: { fn: 'gone', via: 'out' } }]).failed, 'returnVar `gone.out`');
  let ATNONE = 'no throw';
  try {
    routeShapes(ATSRC, [{}]);
  } catch (e) {
    ATNONE = /exactly one of/.test(e.message) ? 'named the rule' : e.message;
  }
  ck('a route that declares NO source throws', ATNONE, 'named the rule');
  let ATBOTH = 'no throw';
  try {
    routeShapes(ATSRC, [{ guarded: 'apneaTyping', builtBy: 'typeIt' }]);
  } catch (e) {
    ATBOTH = /exactly one of/.test(e.message) ? 'named the rule' : e.message;
  }
  ck('…and a route that declares TWO throws as well', ATBOTH, 'named the rule');
  ck('one route alone carries its own partial mechanism through', routeShapes(ATGU, [{ guarded: 'apneaTyping' }]).partialKind, 'undefined-value');
  ck('…and keeps the key it names', routeShapes(ATGU, [{ guarded: 'apneaTyping' }]).partial, ['usable']);
  ck('an empty route list refuses', routeShapes(ATSRC, []), null);

  const ATSURF = { obstructive: 'export-only', total: 'export-only', usable: 'export-only' };
  const ATDECL = (over) => ({ routes: [{ guarded: 'apneaTyping' }], aliasPath: 'fusion.apneaTyping', surfaces: ATSURF, ...(over || {}) });
  const ATRD = 'function draw(){ hero(fusion.window.overlapMin); }';
  ck('🔴 a routed subtree of export-only keys passes with NO reader and no alias', evaluateNested('apneaTyping', routeShapes(ATG, [{ guarded: 'apneaTyping' }]), ATDECL(), ATRD).ok, true);
  ck('…and it reports the shape source it was read from', evaluateNested('apneaTyping', routeShapes(ATG, [{ guarded: 'apneaTyping' }]), ATDECL(), ATRD).shapeKind, 'routes');
  const ATCARD = evaluateNested('apneaTyping', routeShapes(ATG, [{ guarded: 'apneaTyping' }]), ATDECL({ surfaces: { ...ATSURF, usable: 'card' } }), ATRD);
  ck('…while a `card` no realm reads reds, as at every other depth', ATCARD.ok, false);
  ck('…and the reason names the key', nestedReasons(ATCARD).join(' ').includes('usable'), true);
  const ATPART = evaluateNested(
    'apneaTyping',
    routeShapes(ATSRC, ATROUTES),
    { routes: ATROUTES, aliasPath: 'fusion.apneaTyping', surfaces: { ...ATSURF, alpha: 'export-only', beta: 'export-only', events: 'export-only' } },
    ATRD
  );
  ck('🔴 a key present on one route only must be DECLARED partial, or the declaration understates the export', ATPART.ok, false);
  ck(
    '…and declaring every one of them passes',
    evaluateNested(
      'apneaTyping',
      routeShapes(ATSRC, ATROUTES),
      {
        routes: ATROUTES,
        aliasPath: 'fusion.apneaTyping',
        surfaces: { ...ATSURF, alpha: 'export-only', beta: 'export-only', events: 'export-only' },
        partialShape: { alpha: 'x', beta: 'x', events: 'x', obstructive: 'x', total: 'x', usable: 'x' }
      },
      ATRD
    ).ok,
    true
  );
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
