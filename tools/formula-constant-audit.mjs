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
 *     node tools/formula-constant-audit.mjs --selftest
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
    /* Tag-strip to FIXPOINT, then decode entities in ONE pass. Both shapes are deliberate and both
       were CodeQL findings on the first version of this file (`js/incomplete-multi-character-sanitization`
       and `js/double-escaping`), one of which was a real defect:

       · SEQUENTIAL unescaping double-decodes. Replacing `&#xNN;` and then `&amp;` turned a deliberately
         escaped literal `&amp;#x41;` into `&#x41;` — indistinguishable from a live entity, i.e. the tool
         reported a construct the document does not contain. Reproduced before fixing. A single pass over
         one alternation consumes each source construct exactly once, so an escaped literal stays literal.
       · A single `<[^>]+>` pass can leave `<script` behind on nested or malformed markup. This tool reads
         only repo-owned guides and renders nothing, so that is not an injection risk here — but "not
         exploitable" is not "correct", and a tag left behind is text this sweep would then mine for
         constants. Looping to a fixpoint is three lines and removes the question. */
    const stripTags = (t) => {
      let prev;
      let cur = t;
      do {
        prev = cur;
        cur = cur.replace(/<[^<>]*>/g, '');
      } while (cur !== prev);
      return cur;
    };
    const ENT = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g;
    const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const decode = (t) =>
      t.replace(ENT, (_m, hex, dec, name) => {
        if (name) return NAMED[name];
        const cp = Number.parseInt(hex || dec, hex ? 16 : 10);
        /* Out-of-range is exactly the `&#x201CFair` case: refuse rather than throw or guess. */
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _m;
      });
    const strip = (t) => decode(stripTags(t.replace(/<(s|del)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')));
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

/* ⚠️ THE FLAG IS `--selftest`, UNHYPHENATED, AND THAT IS LOAD-BEARING — `--self-test` is accepted only
   as an alias. Both the CI step (`tests.yml`, "Analysis-tool selftests", a `grep -rln -- '--selftest'`
   loop) and `tools/selftest-all.mjs` DISCOVER tools by that literal. This file originally spelled it
   hyphenated and used `===`, so it matched neither discovery form and was silently NOT ENROLLED: 44
   tools ran, this one never did, and its absence was indistinguishable from it passing. The CI step's
   "refuse a run finding fewer than ten" floor cannot see it either — the floor was met by the other 44.
   The banner must also read `all N selftests passed`: that is the string the runner parses for the
   COUNT, and a count is what makes a suite silently shrinking from 12 legs to 3 visible. */
if (process.argv.includes('--selftest') || process.argv.includes('--self-test')) {
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
  /* Decoder properties — every one a CodeQL finding or a near-miss on the first version. */
  const fx = (t) => parseGuide('<div class="mh"><span class="ma">M</span><div class="ft">' + t + '</div></div>')[0].formula;
  eq(fx('&amp;amp;') === '&amp;', 'nested escape survives exactly ONE decode (no double-unescape)');
  eq(fx('&#x201CFair') === '&#x201CFair', 'an UNTERMINATED reference is left intact — it must stay reportable');
  eq(fx('&#x110000;') === '&#x110000;', 'out-of-range code point is refused, not thrown and not guessed');
  eq(fx('&#xB1;10.8') === '\u00b110.8', 'a well-formed reference decodes');
  eq(fx('<b>a</b><i>b</i>') === 'ab', 'tags stripped to fixpoint');
  const struck = parseGuide('<div class="mh"><span class="ma">S</span><div class="ft">now 0.88 <s>was 0.87</s></div></div>');
  eq(struck[0].formula.includes('0.88') && !struck[0].formula.includes('0.87'), 'struck text is dropped, not merely untagged');
  console.log(`all ${legs} selftests passed`);
  process.exit(0);
}
if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) process.exit(main());
