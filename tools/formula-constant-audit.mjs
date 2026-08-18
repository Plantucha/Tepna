#!/usr/bin/env node
/*
 * tools/formula-constant-audit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * REFERENCE-GUIDE-AUDIT dimension 2, made repeatable — the sibling of `severity-ladder-audit.mjs`
 * (dimension 3). Dimension 2 asks that a guide's displayed formula match what the node ACTUALLY
 * computes, and the failure it exists to catch is a formula the code has never implemented: the guide
 * described DesSev as `ODI-3 × mean_depth × mean_duration / k` for months while the code integrated an
 * area (DEEP-AUDIT-II §2.2), and printed `LTHR ≈ HR_rest + HRR × 0.87` while the code computed
 * `HRmax × 0.88` — a different FORMULA, ~6 bpm apart, not a different constant.
 *
 * THE CHECKABLE PROJECTION: a formula's DISTINCTIVE NUMERIC CONSTANTS should appear in its node's
 * source. Prose can drift and be argued about; a constant is present or it is not. This does not verify
 * that a formula is *correct* — only that the numbers it prints exist in the code that implements it.
 * Read every flag before believing it (see FALSE POSITIVES).
 *
 * ⚠️ THE CORPUS IS THE WHOLE NODE, AND GETTING THAT WRONG IS THE TOOL'S OWN FAILURE MODE. The first run
 * of this sweep read `oxydex-dsp.js` + `oxydex-render.js` only — 2 of OxyDex's 8 files — and reported 6
 * flags of which 3 were pure artefact, because Karvonen lives in `oxydex-profile.js` and nothing had
 * opened it. Fixing the corpus took 6 → 3. Hence: glob `<node>-*.js`, never a hand-list, and PRINT THE
 * DENOMINATOR (files, formulas, constants checked) on every run so an under-read corpus is visible
 * rather than silently generous.
 *
 * ⚠️ DO NOT MAKE THE ENTITY DECODER LENIENT. It decodes only WELL-FORMED `&#xNN;` references, and that
 * strictness is load-bearing: an ad-hoc Python version of this sweep used a forgiving decoder, silently
 * "repaired" `&#xB110.8` (an UNTERMINATED reference, missing its `;`) into `±10.8`, and reported the card
 * clean. A browser is greedy instead — it consumes `&#xB110` as U+B110 and renders the Hangul syllable
 * `널`. Five such references were live in `OxyDex Reference.html` and this tool is what surfaced them,
 * precisely BECAUSE it refused to guess. A parser that fixes its input cannot report a broken input.
 *
 * ⚠️ AND DO NOT TRIM TRAILING ZEROS FROM INTEGERS. The same ad-hoc version did, so `660` became `66` and
 * matched any code containing those digits — two real flags (`Jubran 1999`'s 660/940 nm wavelengths)
 * silently disappeared. `constantPresent` trims only when the literal contains a `.`; the guard is a
 * one-line `if` and it is the difference between 6 flags and 8.
 *
 * ⚠️ THE DENOMINATOR IS NOT A VERDICT — it catches a SHORT read, never a WRONG one. Printing `N of M`
 * exposes a corpus that was silently truncated; it says nothing about whether the M things matched were
 * the right things. Demonstrated by this very tool: an early run flagged `110.8`, a constant that exists
 * in no formula anywhere — it was extracted from the malformed `&#xB110.8`, and the denominator beside it
 * was perfectly correct while the match was nonsense. A sibling case in another lane: a case-insensitive
 * grep reporting "23 failure-shaped lines" in a wholly GREEN log, every match real, every one the word
 * "failed" inside prose ABOUT failures — a denominator would have printed `23 of 23` and lent the wrong
 * answer MORE confidence. So: print the denominator, then READ THE MATCHES; and for a verdict prefer an
 * aggregate the tool computes itself (`EXIT=`, a TOTAL row) over any count derived from a pattern you
 * wrote — a hand-written pattern encodes what you expected the output to say, which is the one thing a
 * check must never do.
 *
 * ⚠️ OVER-FLAGGING IS THE DESIGN. A missing constant is a QUESTION, not a verdict. Known-good shapes:
 *   · derived display values — ECGDex prints period equivalents beside Hz bands (1/0.15 = 6.7 s), so
 *     `6.7` is absent from code that only carries `0.15`, and correctly so;
 *   · citation cards — `Azarbarzin 2019` quotes a paper's cohort (n=2,743) and hazard ratio (2.73);
 *     described, never implemented;
 *   · methods with no fixed constant at all — OxyDex's FFT card names a search envelope while the code
 *     uses the record's own Fourier bins plus a red-noise test (OXYDEX-FFT-CYCLE-NULL-2026-08-16).
 * Inventing a constant in code to silence a flag would be the defect this audit exists to catch.
 *
 *     node tools/formula-constant-audit.mjs            # sweep every guide
 *     node tools/formula-constant-audit.mjs --self-test
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Constants too common to carry information — a formula containing only these tells us nothing, and
   flagging on them would bury the real signal. Deliberately generous: a missed check is cheaper than a
   flood nobody reads. */
const COMMON = new Set(['0', '1', '2', '3', '5', '10', '12', '15', '20', '24', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100', '1000', '2026']);

export function distinctiveConstants(formula) {
  const nums = new Set(String(formula).match(/\d+\.\d+|\d+/g) || []);
  return [...nums].filter((x) => !COMMON.has(x) && (x.includes('.') || x.length >= 3));
}

export function constantPresent(x, code) {
  /* A constant counts as present under any faithful spelling: literal, float-normalised (`0.40` ->
     `0.4`), or trailing-zero-trimmed. NOT reciprocals — `6.7` for `0.15` is a real derived value and
     must surface as a flag for a human to dismiss, or the tool would hide genuine mismatches too. */
  if (code.includes(x)) return true;
  if (x.includes('.')) {
    if (code.includes(String(Number.parseFloat(x)))) return true;
    if (code.includes(x.replace(/0+$/, '').replace(/\.$/, ''))) return true;
  }
  return false;
}

export function parseGuide(html) {
  /* Metric cards, each `<div class="mh">…` with a `<span class="ma">` name and optional `<div class="ft">`
     formula. Split on the card boundary rather than a non-greedy lookahead: the lookahead form collapses
     to zero matches, which reads exactly like "this guide has no formulas". */
  const out = [];
  for (const c of html.split('<div class="mh">').slice(1)) {
    const nm = /<span class="ma">([\s\S]*?)<\/span>/.exec(c);
    const ft = /<div class="ft">([\s\S]*?)<\/div>/.exec(c);
    if (!nm || !ft) continue;
    const strip = (t) =>
      t
        /* STRUCK TEXT IS WITHDRAWN — drop `<s>…</s>` and `<del>…</del>` BEFORE tag-stripping. A guide
           that corrects itself keeps the old formula visible under a strike so a reader who remembers it
           sees it was retracted (house practice, e.g. the LTHR correction). Checking a retracted formula
           against code asks whether the guide implements a claim it has explicitly withdrawn — the tool
           would flag every honest correction forever, and the cheapest way to silence it would be to
           delete the evidence. Order matters: strip the struck CONTENT first, or `<[^>]+>` removes the
           tags and leaves the withdrawn constants behind. */
        .replace(/<(s|del)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    out.push({ name: strip(nm[1]).trim(), formula: strip(ft[1]).split(/\s+/).join(' ').trim() });
  }
  return out;
}

function nodeSourceFor(guideFile) {
  const node = guideFile.split(' ')[0].toLowerCase();
  const files = readdirSync(ROOT).filter((f) => f.startsWith(node + '-') && f.endsWith('.js'));
  return { files, code: files.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n') };
}

function main() {
  const guides = readdirSync(ROOT)
    .filter((f) => /Reference\.html$/.test(f))
    .sort();
  let F = 0;
  let C = 0;
  let flagged = 0;
  console.log(`DENOMINATOR: ${guides.length} guide(s)\n`);
  for (const g of guides) {
    const { files, code } = nodeSourceFor(g);
    if (!files.length) {
      console.log(`  ${g} — no matching <node>-*.js source, SKIPPED (not "clean")`);
      continue;
    }
    const cards = parseGuide(readFileSync(join(ROOT, g), 'utf8'));
    const hits = [];
    let withConst = 0;
    for (const { name, formula } of cards) {
      const dist = distinctiveConstants(formula);
      if (!dist.length) continue;
      withConst++;
      const missing = dist.filter((x) => !constantPresent(x, code));
      if (missing.length) hits.push({ name, missing, formula });
    }
    F += cards.length;
    C += withConst;
    flagged += hits.length;
    console.log(`  ${g.padEnd(26)} ${files.length} src · ${String(cards.length).padStart(3)} formulas · ${String(withConst).padStart(2)} with constants · ${hits.length} flagged`);
    for (const h of hits) console.log(`        ⚠ ${h.name.slice(0, 26).padEnd(26)} missing ${JSON.stringify(h.missing)}\n            ${h.formula.slice(0, 100)}`);
  }
  console.log(`\n${flagged} flagged of ${C} constant-bearing formula(s), across ${F} formula(s) in ${guides.length} guide(s).`);
  console.log('A flag is a QUESTION — read the card before treating it as a defect (see the header).');
  return 0;
}

if (process.argv.includes('--self-test')) {
  /* The pass count is COUNTED, never written down — a hardcoded "8/8" survives the ninth leg being added
     and then reports a number about a set it no longer describes. */
  let legs = 0;
  const eq = (c, m) => {
    legs++;
    if (!c) {
      console.error('SELF-TEST FAIL: ' + m);
      process.exit(1);
    }
  };
  eq(distinctiveConstants('x = 0.88 * y').includes('0.88'), 'decimal is distinctive');
  eq(!distinctiveConstants('x = 100 - age').length, 'common integers are not distinctive');
  eq(distinctiveConstants('n = 2743').includes('2743'), '>=3 digits is distinctive');
  eq(constantPresent('0.40', 'var hf = 0.4;'), 'float-normalised spelling counts as present');
  eq(constantPresent('0.880', 'hrMax * 0.88'), 'trailing zeros trimmed');
  eq(!constantPresent('6.7', 'var hf = 0.15;'), 'a reciprocal is NOT auto-accepted — it must surface');
  const cards = parseGuide('<div class="mh"><span class="ma">M</span><div class="ft">a = 0.88 b</div></div>');
  eq(cards.length === 1 && cards[0].name === 'M' && cards[0].formula.includes('0.88'), 'card parse');
  eq(parseGuide('<div class="mh"><span class="ma">N</span></div>').length === 0, 'card without a formula is skipped');
  const struck = parseGuide('<div class="mh"><span class="ma">S</span><div class="ft">now 0.88 <s>was 0.87</s></div></div>');
  eq(struck[0].formula.includes('0.88') && !struck[0].formula.includes('0.87'), 'struck text is dropped, not merely untagged');
  console.log(`self-test: ${legs}/${legs} ok`);
  process.exit(0);
}
if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) process.exit(main());
