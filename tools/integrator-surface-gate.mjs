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

     card         rendered for a reader — so `integrator-render.js` MUST mention it
     export-only  carried on the node-export and deliberately not rendered

   The gate reds on exactly three things: a key with no declaration, a `card` key
   that `integrator-render.js` does not READ, and an `export-only` key that it
   does read. A `card` key whose only appearance is PROSE — a comment or a string
   — is the second of those, and the reason names it separately, because absence
   and prose are different repairs.

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
import { prepare } from './find-unwired-js.mjs';

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
    if (!/return \{\s*$/.test(lines[i])) continue;
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

/* 🔴 THE SECOND SUBTREE NEEDED THREE MECHANISMS THE FIRST ONE DID NOT. `fusion.clockSkew` is an
   inline literal with no builder (`inlineShape`), its whole reader surface sits in
   `integrator-app.js` rather than in the render file (`readerFile`), and the app binds it behind a
   `&&` guard and then hands it to a helper one scope on (`forwardedSites`, one hop only). It also
   found a defect in the FIRST subtree's reader: `enclosingFn` took the nearest function header
   above a line, and a callback that had already closed made the binding read as unscoped.

/* 🔴 A SUBTREE NEED NOT HAVE A BUILDER. `fusion.clockSkew` is an inline object literal AT the
   publish site, so `nestedShapes` has no function to read. This reads the literal itself, in
   BLANKED code, and refuses on three states rather than guessing: no anchor line (the shape
   moved), more than one anchor (ambiguous), or a literal that does not close.

   🔴 AND PRESENCE IS CONDITIONAL HERE FOR A SECOND REASON. One literal carries one key list, so
   no key can be missing from "some return shape". A key whose VALUE can be `undefined` is the
   same defect wearing different clothes: `vetoes: skew.vetoes && skew.vetoes.length ?
   skew.vetoes : undefined` leaves the export entirely when nothing was refused, while
   `seamCensus: skew.seamCensus || []` ships even empty. So `partial` here means "can evaluate to
   `undefined`", and `partialKind` names which mechanism produced it. `null` is NOT in that set —
   a null is a value a consumer can read, which is the whole of §∅. */
export function inlineShape(dspText, key) {
  const lines = prepare(dspText).code.split('\n');
  const anchor = new RegExp('^\\s*' + escapeRe(key) + ':\\s*\\{\\s*$');
  const at = [];
  lines.forEach((l, i) => {
    if (anchor.test(l)) at.push(i);
  });
  if (at.length !== 1) return null;
  const start = at[0];
  let d = 0;
  let end = -1;
  for (let j = start; j < lines.length; j++) {
    d += (lines[j].match(/[{[]/g) || []).length - (lines[j].match(/[}\]]/g) || []).length;
    if (j > start && d <= 0) {
      end = j;
      break;
    }
  }
  if (end < 0) return null;
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
  if (!keys.length) return null;
  const union = [...new Set(keys)].sort();
  return {
    shapes: [{ at: start + 1, keys }],
    union,
    partial: union.filter((k) => /\bundefined\b/.test(values[k] || '')),
    partialKind: 'undefined-value'
  };
}

/* 🔴 THE NEAREST HEADER IS NOT THE ENCLOSING ONE. `integrator-app.js:88` binds the skew subtree
   nine lines under a `forEach(function (m) {` callback that closed at :82, and a scan that stopped
   at the first header above reported the site UNSCOPED and credited nothing. So walk every header
   upward and take the first whose brace span CONTAINS the line, which is the tightest real scope.
   Null still means no enclosing function contains it, and the caller then refuses the site. */
/** The enclosing function of a line, in BLANKED code lines. Null when none contains the line. */
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
     object the alias names. */
  const bind = new RegExp('\\b([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(?:[A-Za-z_$][A-Za-z0-9_$.]*\\s*&&\\s*)*' + escapeRe(path) + '(?![A-Za-z0-9_$])');
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

/** The same red conditions as depth 1, plus the undeclared partial shape, for ONE subtree. */
export function evaluateNested(subtree, shapes, decl, renderText) {
  const path = (decl && decl.aliasPath) || 'fusion.' + subtree;
  const blanked = prepare(renderText);
  const found = aliasSites(renderText, path);
  const direct = found.sites.filter((s) => !s.shadows.length);
  const forwarded = forwardedSites(blanked.code.split('\n'), direct);
  const usable = direct.concat(forwarded.filter((f) => !f.shadows.length));
  const surfaces = (decl && decl.surfaces) || {};
  const declaredPartial = (decl && decl.partialShape) || {};
  const union = shapes.union;
  const read = (k) => readsNested(renderText, usable, k, blanked);
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
  const noAlias = !usable.length && cardDeclared.length > 0;
  return {
    subtree,
    path,
    keys: union,
    shapes: shapes.shapes.map((s) => ({ at: s.at, keys: s.keys.length })),
    partial: shapes.partial,
    partialKind: shapes.partialKind || 'return-shape',
    readerFile: (decl && decl.readerFile) || 'integrator-render.js',
    aliasSites: found.sites.map((s) => ({ line: s.line, alias: s.alias, shadows: s.shadows })),
    forwarded: forwarded.map((f) => ({ line: f.line, alias: f.alias, via: f.via, hopFrom: f.hopFrom, shadows: f.shadows })),
    aliasUnresolved: found.unresolved,
    noAlias,
    undeclared,
    badValue,
    cardUnrendered,
    exportOnlyRead,
    stale,
    undeclaredPartial,
    stalePartial,
    blankedBy: found.blankedBy,
    ok: !noAlias && !undeclared.length && !badValue.length && !cardUnrendered.length && !exportOnlyRead.length && !undeclaredPartial.length && !stalePartial.length
  };
}

/** The reasons, in the order a reader needs them. Empty when the subtree is clean. */
export function nestedReasons(n) {
  return [
    n.noAlias ? `no usable binding of \`${n.path}\` survives in ${n.readerFile} — every alias site is shadowed or unscoped, so no nested read can be credited` : '',
    n.undeclared.length ? `${n.undeclared.length} nested key(s) of \`${n.path}\` declare no surface: ${n.undeclared.join(', ')}` : '',
    n.badValue.length ? `${n.badValue.length} nested key(s) declare something other than 'card' or 'export-only': ${n.badValue.join(', ')}` : '',
    n.cardUnrendered.length ? `${n.cardUnrendered.length} nested key(s) declare 'card' and no anchored read of \`${n.path}\` in ${n.readerFile} reaches them: ${n.cardUnrendered.join(', ')}` : '',
    n.exportOnlyRead.length ? `${n.exportOnlyRead.length} nested key(s) declare 'export-only' and an anchored read reaches them: ${n.exportOnlyRead.join(', ')}` : '',
    n.undeclaredPartial.length
      ? `${n.undeclaredPartial.length} nested key(s) ${n.partialKind === 'undefined-value' ? 'can evaluate to `undefined` and leave the export' : 'exist on some return shapes only'}, with no partialShape reason declared: ${n.undeclaredPartial.join(', ')}`
      : '',
    n.stalePartial.length ? `${n.stalePartial.length} partialShape declaration(s) name a key whose presence is no longer conditional: ${n.stalePartial.join(', ')}` : ''
  ].filter(Boolean);
}

/** The three red conditions, and nothing else. */
export function evaluate(keys, surfaces, renderText) {
  const { code, by } = prepare(renderText);
  const undeclared = keys.filter((k) => !surfaces[k]);
  const badValue = keys.filter((k) => surfaces[k] && !SURFACES.includes(surfaces[k]));
  const cardUnrendered = keys.filter((k) => surfaces[k] === 'card' && !reads(code, renderText, k));
  /* The subset whose reason is PROSE and not absence — the state nothing could see until today. */
  const cardProseOnly = cardUnrendered.filter((k) => mentions(renderText, k));
  const exportOnlyRead = keys.filter((k) => surfaces[k] === 'export-only' && reads(code, renderText, k));
  const stale = Object.keys(surfaces).filter((k) => !keys.includes(k));
  return {
    undeclared,
    badValue,
    cardUnrendered,
    cardProseOnly,
    exportOnlyRead,
    stale,
    blankedBy: by,
    ok: !undeclared.length && !badValue.length && !cardUnrendered.length && !exportOnlyRead.length
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
  const r = evaluate(keys, decl.surfaces || {}, render);

  /* THE NESTED SUBTREES, one entry at a time. A declared subtree whose builder shape has moved
     REFUSES — the same fail-closed rule the slim-export literal already carries above. */
  const nested = [];
  const readers = new Map([['integrator-render.js', render]]);
  for (const [sub, d] of Object.entries(decl.nested || {})) {
    if (!d) throw new Error(`nested subtree \`${sub}\` declares nothing`);
    const byFn = !!d.builtBy;
    const byLiteral = d.inline === true;
    if (byFn === byLiteral) throw new Error(`nested subtree \`${sub}\` must declare exactly one of builtBy or inline:true — the gate must not guess where its shape lives`);
    const shapes = byFn ? nestedShapes(dsp, d.builtBy) : inlineShape(dsp, sub);
    if (!shapes)
      throw new Error(
        byFn
          ? `${d.builtBy}() was not found, or one of its return objects does not close — its shape changed, and this gate must not guess`
          : `the inline \`${sub}: {\` literal in integrator-dsp.js was not found, appears more than once, or does not close — its shape changed, and this gate must not guess`
      );
    const rf = d.readerFile || 'integrator-render.js';
    if (!readers.has(rf)) readers.set(rf, readFileSync(join(ROOT, rf), 'utf8'));
    nested.push(evaluateNested(sub, shapes, d, readers.get(rf)));
  }
  const nestedBad = nested.filter((n) => !n.ok);
  const nestedKeys = nested.reduce((t, n) => t + n.keys.length, 0);
  const nestedCard = nested.reduce((t, n) => t + n.keys.filter((k) => (decl.nested[n.subtree].surfaces || {})[k] === 'card').length, 0);
  const cards = keys.filter((k) => (decl.surfaces || {})[k] === 'card').length;
  const v = Verdict.make({
    gate: 'integrator-surface',
    scope: 'internal',
    status: r.ok && !nestedBad.length ? 'PASS' : 'FAIL',
    population: { checked: keys.length + nestedKeys, eligible: keys.length + nestedKeys, excluded: 0 },
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
      nestedReaderFiles: [...new Set(nested.map((n) => n.readerFile))],
      nestedInline: nested.filter((n) => n.partialKind === 'undefined-value').length,
      card: cards,
      exportOnly: keys.length - cards,
      undeclared: r.undeclared.length,
      cardUnrendered: r.cardUnrendered.length,
      cardProseOnly: r.cardProseOnly.length,
      exportOnlyRead: r.exportOnlyRead.length,
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
            r.cardUnrendered.length ? r.cardUnrendered.length + " key(s) declare 'card' but integrator-render.js does not read them: " + r.cardUnrendered.join(', ') : '',
            r.cardProseOnly.length ? r.cardProseOnly.length + ' of those appear ONLY in prose, a comment or a string, and never as a read: ' + r.cardProseOnly.join(', ') : '',
            r.exportOnlyRead.length ? r.exportOnlyRead.length + " key(s) declare 'export-only' and integrator-render.js reads them: " + r.exportOnlyRead.join(', ') : ''
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
        ` · depth 1 — a nested property is examined only inside a declared subtree (${nested.length} declared)`
    );
  if (!JSON_ONLY)
    for (const n of nested)
      console.log(
        `  ✓ ${n.path} at depth 2: ${n.keys.length} key(s) · ${n.keys.filter((k) => (decl.nested[n.subtree].surfaces || {})[k] === 'card').length} card · ${n.partial.length} ${n.partialKind === 'undefined-value' ? 'able to evaluate to `undefined`' : 'on some return shape(s) only'}` +
          ` · ${n.readerFile} read through ${n.aliasSites.length} anchored alias site(s) (${n.aliasSites.map((a) => a.alias + '@' + a.line).join(', ') || 'none'})` +
          (n.forwarded.length ? ` + ${n.forwarded.length} one-hop forward (${n.forwarded.map((f) => f.via + '(' + f.alias + ')@' + f.line).join(', ')})` : '')
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
  ck('🔴 TWO anchors return null — ambiguity is a refusal, not a choice', inlineShape(ISRC + '\n' + ISRC, 'skewBlock'), null);
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
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
