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

   The gate reds on exactly two things: a key with no declaration, and a `card`
   key that `integrator-render.js` does not mention. `export-only` is never red —
   it is a stated choice, which is the whole point of declaring it.

   🔴 THE SEED IS DERIVED, SO THE FIRST RUN PROVES NOTHING ABOUT TODAY. The
   declarations were seeded by scanning render for each key on 2026-10-11, so
   today's PASS is true by construction — the same shape as residue
   `2026-09-28-generator-compared-to-itself-examines-no-artifact`. What the gate
   can see is DRIFT from that seed: a new key nobody declared, or a `card` key
   whose render mention is deleted. Both are future states, and both are planted
   in `--selftest` rather than assumed.

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

export function mentions(renderText, key) {
  return new RegExp('\\b' + escapeRe(key) + '\\b').test(renderText);
}

/** The two red conditions, and nothing else. */
export function evaluate(keys, surfaces, renderText) {
  const undeclared = keys.filter((k) => !surfaces[k]);
  const badValue = keys.filter((k) => surfaces[k] && !SURFACES.includes(surfaces[k]));
  const cardUnrendered = keys.filter((k) => surfaces[k] === 'card' && !mentions(renderText, k));
  const stale = Object.keys(surfaces).filter((k) => !keys.includes(k));
  return { undeclared, badValue, cardUnrendered, stale, ok: !undeclared.length && !badValue.length && !cardUnrendered.length };
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
    criterion: { name: 'undeclared_or_unrendered_card_keys', threshold: 0, unit: 'keys', direction: 'lte' },
    result: { keys: keys.length, card: cards, exportOnly: keys.length - cards, undeclared: r.undeclared.length, cardUnrendered: r.cardUnrendered.length, staleDeclarations: r.stale.length },
    evidence: ['tools/integrator-surface-gate.mjs', 'tools/integrator-surface.json', 'briefs/INTEGRATOR-SURFACE-2026-10-11-BRIEF.md'],
    reason: r.ok
      ? null
      : [
          r.undeclared.length ? r.undeclared.length + ' key(s) declare no surface: ' + r.undeclared.join(', ') : '',
          r.badValue.length ? r.badValue.length + " key(s) declare something other than 'card' or 'export-only': " + r.badValue.join(', ') : '',
          r.cardUnrendered.length ? r.cardUnrendered.length + " key(s) declare 'card' but integrator-render.js does not mention them: " + r.cardUnrendered.join(', ') : ''
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
  if (!JSON_ONLY) console.log(`✓ ${keys.length} Integrator key(s): ${cards} card · ${keys.length - cards} export-only · 0 undeclared`);
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
        criterion: { name: 'undeclared_or_unrendered_card_keys', threshold: 0, unit: 'keys', direction: 'lte' },
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
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
