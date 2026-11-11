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
  const render = readFileSync(join(ROOT, 'integrator-render.js'), 'utf8');
  const decl = JSON.parse(readFileSync(DECL_PATH, 'utf8'));
  const keys = fusionKeys(dsp);
  const r = evaluate(keys, decl.surfaces || {}, render);
  const cards = keys.filter((k) => (decl.surfaces || {})[k] === 'card').length;
  const v = Verdict.make({
    gate: 'integrator-surface',
    scope: 'internal',
    status: r.ok ? 'PASS' : 'FAIL',
    population: { checked: keys.length, eligible: keys.length, excluded: 0 },
    criterion: { name: 'undeclared_or_misdeclared_keys', threshold: 0, unit: 'keys', direction: 'lte' },
    result: {
      keys: keys.length,
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
    reason: r.ok
      ? null
      : [
          r.undeclared.length ? r.undeclared.length + ' key(s) declare no surface: ' + r.undeclared.join(', ') : '',
          r.badValue.length ? r.badValue.length + " key(s) declare something other than 'card' or 'export-only': " + r.badValue.join(', ') : '',
          r.cardUnrendered.length ? r.cardUnrendered.length + " key(s) declare 'card' but integrator-render.js does not read them: " + r.cardUnrendered.join(', ') : '',
          r.cardProseOnly.length ? r.cardProseOnly.length + ' of those appear ONLY in prose, a comment or a string, and never as a read: ' + r.cardProseOnly.join(', ') : '',
          r.exportOnlyRead.length ? r.exportOnlyRead.length + " key(s) declare 'export-only' and integrator-render.js reads them: " + r.exportOnlyRead.join(', ') : ''
        ]
          .filter(Boolean)
          .join(' · '),
    producedBy: { tool: 'tools/integrator-surface-gate.mjs', commit: gitCommit() }
  });
  /* `--json` is the documented "verdict only": without it stdout carries the object AND the ✓ line,
     which reads well and does not parse. Nothing read the flag until 2026-10-21. */
  const JSON_ONLY = process.argv.includes('--json');
  console.log(JSON.stringify(v));
  if (!r.ok) {
    console.error('✗ ' + v.reason);
    process.exit(1);
  }
  if (!JSON_ONLY) console.log(`✓ ${keys.length} Integrator key(s): ${cards} card · ${keys.length - cards} export-only · 0 undeclared · reads blanked by ${r.blankedBy}`);
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
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
