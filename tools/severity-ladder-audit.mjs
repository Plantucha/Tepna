#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * severity-ladder-audit.mjs — does a node ever render the SAME metric with two different
 * good/warn/bad boundaries?
 * ----------------------------------------------------------------------------
 * `REFERENCE-GUIDE-AUDIT-BRIEF` dimension 3 asks that normative bands be "defensible, not invented",
 * with directions and boundaries sanity-checked. It checks the GUIDE against the literature. This
 * checks the CODE against itself, which is the cheaper half and was never done: a metric rendered
 * with one ladder on the summary card and a different one in the detail grid is wrong on one of the
 * two surfaces no matter which band is right, and the user sees both on the same screen.
 *
 * ── WHAT IT MATCHES ─────────────────────────────────────────────────────────────────────────────
 *
 * The house idiom for a severity ladder:  EXPR < A ? 'good' : EXPR < B ? 'warn' : 'bad'
 * (also `>`, `>=`, `<=`, and `ok` for `good`). Both comparisons must be on the SAME expression text,
 * which is what makes two sites comparable — a shared local like `v` is therefore reported separately
 * per file+scope and is not, on its own, evidence of anything.
 *
 * ── WHY IT REPORTS RATHER THAN GATES ────────────────────────────────────────────────────────────
 *
 * There is a live finding it would red on (OxyDex ODI-3, below), and a gate that cannot go green on
 * the day it lands is a broken build, not a standard. It becomes a gate once the finding is resolved
 * — and resolving it needs a clinical cut-point decision, which is explicitly not this tool's to make.
 *
 * ── THE FALSE-POSITIVE THIS DELIBERATELY KEEPS ──────────────────────────────────────────────────
 *
 * Two ladders on one expression can be legitimate when the surfaces mean different things (a "tonight"
 * card vs a "90-day trend" card may honestly band differently). The tool cannot tell those apart, so it
 * prints both sites and leaves the judgement to a reader. It is an audit aid, not an oracle — the
 * alternative, silently suppressing pairs by some heuristic, is how a check stops catching things.
 *
 * USAGE  node tools/severity-ladder-audit.mjs
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = fs
  .readdirSync(ROOT)
  .filter((f) => /-(app|render)\.js$/.test(f))
  .sort();

/* EXPR cmp A ? 'good' : EXPR cmp B ? 'warn' : 'bad' — the second EXPR must match the first verbatim. */
const LADDER = /([A-Za-z_$][\w$.]*(?:\[[^\]]*\])?(?:\.[\w$]+)*)\s*(<=|>=|<|>)\s*(-?[\d.]+)\s*\?\s*'(good|ok)'\s*:\s*\1\s*(<=|>=|<|>)\s*(-?[\d.]+)\s*\?\s*'warn'\s*:\s*'bad'/g;

const byNode = new Map();
for (const f of FILES) {
  const node = f.replace(/-(app|render)\.js$/, '');
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LADDER)) {
      // m[4] is the good|ok alternation — skip it, or op2/b land one group early.
      const [, expr, op1, a, , op2, b] = m;
      const key = node + '::' + expr;
      if (!byNode.has(key)) byNode.set(key, []);
      byNode.get(key).push({ file: f, line: i + 1, ladder: `${op1}${a} / ${op2}${b}`, ctx: line.trim().slice(0, 110) });
    }
  });
}

let conflicts = 0;
let total = 0;
console.log('Severity-ladder audit — the same metric expression banded two different ways within one node\n');
for (const [key, hits] of [...byNode.entries()].sort()) {
  total++;
  const distinct = new Set(hits.map((h) => h.ladder));
  if (distinct.size < 2) continue;
  conflicts++;
  const [node, expr] = key.split('::');
  console.log(`  ⚠ ${node} — ${expr}   (${distinct.size} different ladders)`);
  for (const h of hits) console.log(`      ${h.file}:${h.line}  ${h.ladder}`);
  console.log('');
}
console.log(`${conflicts} conflicting of ${total} laddered expression(s) across ${FILES.length} render/app file(s).`);
if (!conflicts) console.log('  (no expression is banded two ways — the class this tool exists for is clear)');
console.log('\nNOTE: a shared local name (e.g. `v`) can collide across unrelated metrics in one file.');
console.log('Read the sites before treating a pair as a defect — see the header.');
