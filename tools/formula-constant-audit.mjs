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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict } from './verdict-emit.mjs';
import { isCliEntry } from './argv-guard.mjs';

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

/* The guide-text normaliser, HOISTED out of `parseGuide` so the description sweep uses the byte-same
   path rather than a second copy that drifts. Every defence in it was bought by a specific failure — see
   the header: fixpoint tag-stripping, a SINGLE-pass entity decode (sequential passes double-decoded an
   escaped literal into a live entity), refusal on an out-of-range code point, and dropping <s>/<del> so a
   struck-through correction is not mined as a live claim. */
export function stripGuideText(t) {
  const stripTags = (x) => {
    let prev;
    let cur = x;
    do {
      prev = cur;
      cur = cur.replace(/<[^<>]*>/g, '');
    } while (cur !== prev);
    return cur;
  };
  const ENT = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g;
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (x) =>
    x.replace(ENT, (_m, hex, dec, name) => {
      if (name) return NAMED[name];
      const cp = Number.parseInt(hex || dec, hex ? 16 : 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _m;
    });
  return decode(stripTags(String(t).replace(/<(s|del)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')));
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
    const strip = stripGuideText;
    out.push({ name: strip(nm[1]).trim(), formula: strip(ft[1]).split(/\s+/).join(' ').trim() });
  }
  return out;
}

/* ── DESCRIPTIONS (`<p class="md">`) — DEEP-AUDIT-VI §2.5b ────────────────────────────────────────
   The sibling corpus, and the LARGER one: 404 descriptions against 389 formulas across the 7 guides.
   `parseGuide` above reads `.ft` and treats it as a formula; the sentence telling a user what a number
   MEANS lives in `.md` and had never been compared to code.

   A SEPARATE parser rather than relaxing `parseGuide`, deliberately: its selftest pins "card without a
   formula is skipped", which is a contract other callers rely on. Widening it to admit description-only
   cards would silently change what the formula sweep counts.

   ⚠️ THE FILTER WAS PRE-REGISTERED BEFORE THE FIRST RUN, and that is load-bearing rather than
   ceremonial. Prose numerals are mostly incidental — a citation year, a cohort size, a page — so the
   `.ft` sweep's 5-of-68 rate cannot transfer, and whatever number came out first would have become the
   anchor. Bands fixed in advance: fewer than 40 checkable claims across 404 descriptions means the
   filter is TOO TIGHT; more than 30% of checkable claims flagged means it is TOO LOOSE and the
   incidental numerals are dominating. Either verdict is a redesign, NOT a finding to publish. */
export function parseGuideDescriptions(html) {
  const out = [];
  for (const c of html.split('<div class="mh">').slice(1)) {
    const nm = /<span class="ma">([\s\S]*?)<\/span>/.exec(c);
    const md = /<p class="md">([\s\S]*?)<\/p>/.exec(c);
    if (!nm || !md) continue;
    out.push({ name: stripGuideText(nm[1]).trim(), description: stripGuideText(md[1]).split(/\s+/).join(' ').trim() });
  }
  return out;
}

/* KEEP a numeral only where it is BOUND to a unit or a comparator — an unbound number in prose is
   almost never a claim about the code. Bare counts ("reported at 10 levels") are STRUCTURAL claims and
   are deliberately out of scope: §2.5b names that blind spot, and a numeral key cannot reach it. */
const CLAIM_UNIT = '(?:%|Hz|ms|minutes?|mins?|seconds?|secs?|hours?|hrs?|bpm|nm|mg\\/dL|mmol\\/L|s|h)';
const CLAIM_CMP = '(?:>=|<=|[<>≥≤]|below|above|under|over|within)';
export function claimConstants(text) {
  const t = String(text || '');
  const found = new Set();
  /* number followed by a unit — "5-minute", "90%", "1 Hz", "0.3 s" */
  for (const m of t.matchAll(new RegExp('(\\d+(?:\\.\\d+)?)[\\s\u202f\u00a0-]*' + CLAIM_UNIT + '(?![A-Za-z])', 'gi'))) found.add(m[1]);
  /* comparator followed by a number — "below 90", "≥ 3" */
  for (const m of t.matchAll(new RegExp(CLAIM_CMP + '[\\s\u202f\u00a0]*(\\d+(?:\\.\\d+)?)', 'gi'))) found.add(m[1]);
  const out = [];
  for (const v of found) {
    /* DROP a citation year. 1900-2100 as a BARE integer only — 2000 ms is a real claim. */
    if (/^\d{4}$/.test(v) && +v >= 1900 && +v <= 2100 && new RegExp('(?<![.\\d])' + v + '(?![.\\d%])').test(t)) {
      if (new RegExp('[A-Za-z]{3,}[\\s,]+(?:et al\\.?[\\s,]+)?\\(?' + v).test(t)) continue;
    }
    /* DROP a cohort size — "n=2,743", "N of 37". */
    if (new RegExp('[nN]\\s*(?:=|of)\\s*' + v.replace('.', '\\.')).test(t)) continue;
    out.push(v);
  }
  return out.sort();
}

export function nodeNameFor(guidePath) {
  const base = guidePath.slice(guidePath.lastIndexOf('/') + 1);
  return base.split(/[\s-]/)[0].toLowerCase();
}

function nodeSourceFor(guidePath) {
  /* Two guide name shapes exist in the tree: `OxyDex Reference.html` at the root and
     `eegdex-reference.html` under `codegen/generated/`. Read the BASENAME and cut at the first space
     or hyphen, so both resolve to their node. `split(' ')[0]` over the second shape answers the whole
     filename and the guide then reads as "no matching source", which is false. */
  const node = nodeNameFor(guidePath);
  const files = readdirSync(ROOT).filter((f) => f.startsWith(node + '-') && f.endsWith('.js'));
  return { files, code: files.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n') };
}

/* ── THE CORPUS IS THE TRACKED TREE, AND A REJECTION NAMES ITS REASON ───────────────────────────────
   `readdirSync(ROOT).filter(/Reference\.html$/)` answers the 8 root guides and drops
   `codegen/generated/eegdex-reference.html`, which is tracked, generated, and carried by a node whose
   sources sit in the root. That guide left the corpus BEFORE the loop, so `guidesSkipped` — an in-loop
   counter — published 0 over a tree that holds 9 guides, and a reader could not tell "nothing was
   omitted" from "the omission happened before the counter"
   (residue 2026-11-10-the-formula-audit-corpus-omits-the-ninth-reference-guide).
   Every candidate this builder drops is REPORTED with its reason and counted, so a path leaves the
   corpus in the open. It FAILS CLOSED: an unreadable tracked list returns an error and the caller
   publishes NOT_RUN, never an empty corpus that reads as a clean sweep. */
export function classifyGuidePaths(paths) {
  const guides = [];
  const rejected = [];
  for (const path of [...paths].sort()) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    /* Both shapes, and nothing else — a file merely holding the word is not a guide. */
    if (!/(?: Reference|-reference)\.html$/.test(base)) continue;
    if (path.startsWith('docs/')) {
      rejected.push({ path, reason: 'a served copy that tools/build-docs.mjs owns and npm run verify:docs checks' });
      continue;
    }
    if (path.startsWith('papers/')) {
      rejected.push({ path, reason: 'a paper, so it carries no <node>-*.js source to check a constant against' });
      continue;
    }
    guides.push(path);
  }
  return { guides, rejected, error: null };
}

/* The fs/spawn shell around the pure classifier. It stays THIN on purpose: every leg of the selftest
   calls `classifyGuidePaths` with a path list, so the selftest reads no file and spawns nothing, and
   this tool stays out of the `flag-exit-scan` census that a module-scope read below the health-flag
   exit would put it in. */
function guideCorpus() {
  let tracked;
  try {
    tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\0')
      .filter(Boolean);
  } catch (e) {
    return { guides: [], rejected: [], error: `git ls-files failed: ${e && e.message ? e.message : e}` };
  }
  return classifyGuidePaths(tracked);
}

/* The `.md` sweep — same corpus discipline as main(): glob the node's sources, print the denominator,
   and SKIP loudly where no source matched rather than reporting the guide clean. */
/* ── THE VERDICT ─ the bar is on the INSTRUMENT, and FAIL is unreachable ────────────────────────────────
   Two modes, one builder, both wired — an adoption that covered one would be half-wired.
   `--descriptions` carries two PRE-REGISTERED calibration bands and refuses to publish outside them:
   claim-bearing >= 40 (floor), flagged rate <= 30 % (ceiling); out of band it says, in its own words,
   "REDESIGN, not a finding; do not publish a rate". The default formula mode carries no bands.
   In both, the criterion binds on the EXTRACTOR, never on the corpus — an adoption must not change
   what a tool decides.

   ⚠ A BAND VIOLATION IS `UNKNOWN`, NOT `FAIL`. The reader reads the GATE NAME: `formula-constant-audit:
   FAIL` reaches every regex-reader as "the guide constants are wrong", which is the finding this tool
   declines to assert. UNKNOWN is the contract's word for "the instrument cannot answer", and that is
   what a miscalibrated filter is. FAIL is therefore REACHABLE FROM NOTHING — stated in criterion.name
   so nobody later adds a FAIL branch keyed on flag count: flags are QUESTIONS to hand-verify, and they
   travel in `result`, never as failures.

   ⚠ POPULATION IN ONE UNIT. D counts descriptions (or formulas); K and U count claim VALUES; mixing them
   in one equality would be two populations under one name. eligible = D, checked = Ck (items with >= 1
   checkable value), excluded = (D - C) dropped as non-claim-bearing + (C - Ck) claim-bearing but every
   value refused. The filter's selectivity — the thing the bands calibrate — is visible in the equality,
   not only in the floor. The value-level split (K / U) rides in `result`. */
export function fcaVerdict({ mode, D, C, Ck, K, U, flagged, rate, guides, guidesSkipped, guidesRejected = 0, guidesNoItems = 0, rejections = [], corpusError = null, hits, at, commit, commitReason }) {
  const bands = mode === 'descriptions';
  const violated = [];
  if (bands && C < 40) violated.push(`FILTER TOO TIGHT: ${C} claim-bearing of ${D} descriptions, pre-registered floor is 40`);
  if (bands && C >= 40 && rate > 0.3) violated.push(`FILTER TOO LOOSE: ${(rate * 100).toFixed(0)}% of claim-bearing flagged, pre-registered ceiling is 30%`);
  const base = {
    tool: 'tools/formula-constant-audit.mjs',
    gate: bands ? 'formula-constant-audit --descriptions' : 'formula-constant-audit',
    scope: 'internal',
    criterion: {
      name: bands
        ? 'the extractor is within its PRE-REGISTERED calibration bands (claim-bearing >= 40, flagged <= 30%). A bar on the INSTRUMENT, not the corpus: out of band the tool cannot answer (UNKNOWN), and FAIL is reachable from nothing — flags are questions to hand-verify, never failures'
        : 'formula mode carries NO calibration bands: PASS means the sweep ran over >= 1 formula and its flags are questions in result. FAIL is reachable from nothing — a flag is a QUESTION, never a failure',
      direction: 'eq',
      threshold: 0,
      unit: 'calibration bands violated'
    },
    evidence: ['tools/formula-constant-audit.mjs', 'audits/CITATION-VERIFICATION-2026-08-05.md'],
    at,
    commit,
    commitReason
  };
  const unit = bands ? 'descriptions' : 'formulas';
  if (!D)
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { eligible: 0, checked: 0, excluded: 0 },
      result: null,
      reason: corpusError
        ? `the corpus could not be read, so nothing was examined: ${corpusError}`
        : `no ${unit} examined: ${guides} guide(s) found, ${guidesSkipped} skipped for having no matching <node>-*.js source, ${guidesRejected} rejected before the loop`
    });
  const dropped = D - C;
  const allRefused = C - Ck;
  const population = { eligible: D, checked: Ck, excluded: dropped + allRefused };
  const result = {
    mode,
    unit,
    items: D,
    claimBearing: C,
    checkedItems: Ck,
    droppedNonClaimBearing: dropped,
    claimBearingAllRefused: allRefused,
    claimValuesCheckable: K,
    claimValuesRefused: U,
    flagged,
    flaggedRate: rate,
    guides,
    guidesSkipped,
    guidesRejected,
    guidesNoItems,
    rejections: rejections.map((r) => ({ path: r.path, reason: r.reason })),
    bandsViolated: violated.length,
    questions: hits.map((h) => ({ guide: h.guide, name: h.name, missing: h.missing }))
  };
  if (violated.length)
    return makeVerdict({
      ...base,
      status: 'UNKNOWN',
      population,
      result,
      reason: violated.join(' · ') + ' — "This is a REDESIGN, not a finding. Do not publish a rate from this run." The instrument cannot answer; nothing is asserted about the guides.'
    });
  return makeVerdict({ ...base, status: 'PASS', population, result });
}

function mainDescriptions() {
  const corpus = guideCorpus();
  if (corpus.error) {
    console.log(`\u2717 CORPUS UNREADABLE: ${corpus.error}\n  Nothing was examined, and this run asserts nothing about any guide.`);
    console.log(JSON.stringify(fcaVerdict({ mode: 'descriptions', D: 0, C: 0, Ck: 0, K: 0, U: 0, flagged: 0, rate: 0, guides: 0, guidesSkipped: 0, hits: [], corpusError: corpus.error })));
    return 1;
  }
  const guides = corpus.guides;
  let D = 0;
  let C = 0;
  let K = 0;
  let U = 0;
  let flagged = 0;
  let Ck = 0; // descriptions with >= 1 CHECKABLE value — the population's `checked`, in ONE unit
  let guidesSkipped = 0;
  let guidesNoItems = 0;
  console.log(`DENOMINATOR: ${guides.length} guide(s) — DESCRIPTIONS (<p class="md">)\n`);
  for (const r of corpus.rejected) console.log(`  ${r.path} \u2014 REJECTED from the corpus: ${r.reason}`);
  const hitsAll = [];
  for (const g of guides) {
    const { files, code } = nodeSourceFor(g);
    if (!files.length) {
      console.log(`  ${g} — no matching <node>-*.js source, SKIPPED (not "clean")`);
      guidesSkipped++;
      continue;
    }
    const cards = parseGuideDescriptions(readFileSync(join(ROOT, g), 'utf8'));
    /* A guide inside the corpus that parses 0 cards flags nothing, and "0 flagged" then reads as
       clean. Count it and name it: the same confusion the pre-loop drop caused, one layer in. */
    if (!cards.length) guidesNoItems++;
    const hits = [];
    let withClaim = 0;
    for (const { name, description } of cards) {
      const claims = claimConstants(description);
      if (!claims.length) continue;
      withClaim++;
      /* 🔴 PARTITION, NEVER SILENTLY PASS. A short integer cannot be checked against a whole-node
         corpus: `constantPresent` is a substring test over ~717 kB, where every 1-2 digit value is
         present somewhere under EVERY matching strategy tried (plain, word-boundary, and
         comparison-context were each measured `true` for a planted-WRONG 87). Passing them silently
         is what made the first version of this sweep blind — a planted "below 90%" -> "below 87%"
         went undetected while the run reported 1 flag and read clean.
         So they are REFUSED and COUNTED, not checked. Same discipline as DexClock.hostAxis: absent a
         measurement, say so rather than return a zero a caller cannot distinguish from a result. */
      const checkable = claims.filter((x) => x.includes('.') || x.length >= 3);
      const unresolvable = claims.filter((x) => !(x.includes('.') || x.length >= 3));
      U += unresolvable.length;
      K += checkable.length;
      if (checkable.length) Ck++;
      const missing = checkable.filter((x) => !constantPresent(x, code));
      if (missing.length) hits.push({ guide: g, name, missing, description });
    }
    D += cards.length;
    C += withClaim;
    flagged += hits.length;
    hitsAll.push(...hits);
    console.log(`  ${g.padEnd(38)} ${files.length} src · ${String(cards.length).padStart(3)} descriptions · ${String(withClaim).padStart(3)} with claims · ${hits.length} flagged`);
  }
  console.log(`\n${flagged} flagged of ${C} claim-bearing description(s), across ${D} description(s) in ${guides.length} guide(s).`);
  console.log(`CLAIM VALUES: ${K} checkable · ${U} REFUSED as unresolvable at whole-node corpus scope (short integers).`);
  if (U > K) {
    console.log(`⚠ MOST OF THIS CORPUS IS OUT OF REACH: ${U} of ${K + U} claim values cannot be checked here.`);
    console.log('  Prose asserts thresholds ("below 90%"), windows ("5-minute") and rates ("1 Hz") — all short');
    console.log("  integers. Checking them needs the code corpus scoped to the METRIC's own implementation,");
    console.log('  not the whole node. That is a different and larger unit than "point the extractor at .md".');
  }
  /* ⚠️ THE PRE-REGISTERED BANDS, CHECKED BY THE TOOL rather than by the reader's judgement after the
     fact. Written before the first run precisely so a bad filter cannot be reported as a finding. */
  const rate = C ? flagged / C : 0;
  const V = fcaVerdict({
    mode: 'descriptions',
    D,
    C,
    Ck,
    K,
    U,
    flagged,
    rate,
    guides: guides.length,
    guidesSkipped,
    guidesRejected: corpus.rejected.length,
    guidesNoItems,
    rejections: corpus.rejected,
    hits: hitsAll
  });
  if (C < 40) {
    console.log(`\n🔴 FILTER TOO TIGHT — ${C} claim-bearing of ${D} descriptions, pre-registered floor is 40.`);
    console.log('   This is a REDESIGN, not a finding. Do not publish a rate from this run.');
    console.log(JSON.stringify(V));
    return 0;
  }
  if (rate > 0.3) {
    console.log(`\n🔴 FILTER TOO LOOSE — ${(rate * 100).toFixed(0)}% of claim-bearing flagged, pre-registered ceiling is 30%.`);
    console.log('   Incidental numerals are dominating. REDESIGN; do not publish a hand rate from this run.');
    console.log(JSON.stringify(V));
    return 0;
  }
  console.log(`\nWithin the pre-registered bands (${C} claim-bearing >= 40, ${(rate * 100).toFixed(0)}% flagged <= 30%).`);
  console.log('Each flag is a QUESTION. Hand-verify before calling any of them a defect.');
  for (const h of hitsAll.slice(0, 40)) {
    console.log(
      `        ⚠ ${h.guide
        .replace(' Reference.html', '')
        .replace(/^.*\/|-reference\.html$/g, '')
        .padEnd(9)} ${h.name.slice(0, 24).padEnd(24)} missing ${JSON.stringify(h.missing)}`
    );
    console.log(`            ${h.description.slice(0, 104)}`);
  }
  if (hitsAll.length > 40) console.log(`        … and ${hitsAll.length - 40} more`);
  console.log(JSON.stringify(V));
  return 0;
}

function main() {
  const corpus = guideCorpus();
  if (corpus.error) {
    console.log(`\u2717 CORPUS UNREADABLE: ${corpus.error}\n  Nothing was examined, and this run asserts nothing about any guide.`);
    console.log(JSON.stringify(fcaVerdict({ mode: 'formula', D: 0, C: 0, Ck: 0, K: 0, U: 0, flagged: 0, rate: 0, guides: 0, guidesSkipped: 0, hits: [], corpusError: corpus.error })));
    return 1;
  }
  const guides = corpus.guides;
  let F = 0;
  let C = 0;
  let flagged = 0;
  let guidesSkipped = 0;
  let guidesNoItems = 0;
  const hitsAll = [];
  console.log(`DENOMINATOR: ${guides.length} guide(s)\n`);
  for (const r of corpus.rejected) console.log(`  ${r.path} \u2014 REJECTED from the corpus: ${r.reason}`);
  for (const g of guides) {
    const { files, code } = nodeSourceFor(g);
    if (!files.length) {
      console.log(`  ${g} — no matching <node>-*.js source, SKIPPED (not "clean")`);
      guidesSkipped++;
      continue;
    }
    const cards = parseGuide(readFileSync(join(ROOT, g), 'utf8'));
    /* Same reading as in --descriptions: in the corpus and parsing nothing is not clean. */
    if (!cards.length) guidesNoItems++;
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
    hitsAll.push(...hits);
    console.log(`  ${g.padEnd(38)} ${files.length} src · ${String(cards.length).padStart(3)} formulas · ${String(withConst).padStart(2)} with constants · ${hits.length} flagged`);
    for (const h of hits) console.log(`        ⚠ ${h.name.slice(0, 26).padEnd(26)} missing ${JSON.stringify(h.missing)}\n            ${h.formula.slice(0, 100)}`);
  }
  console.log(`\n${flagged} flagged of ${C} constant-bearing formula(s), across ${F} formula(s) in ${guides.length} guide(s).`);
  console.log('A flag is a QUESTION — read the card before treating it as a defect (see the header).');
  console.log(
    JSON.stringify(
      fcaVerdict({
        mode: 'formula',
        D: F,
        C,
        Ck: C,
        K: null,
        U: null,
        flagged,
        rate: C ? flagged / C : 0,
        guides: guides.length,
        guidesSkipped,
        guidesRejected: corpus.rejected.length,
        guidesNoItems,
        rejections: corpus.rejected,
        hits: hitsAll
      })
    )
  );
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
if (process.argv.includes('--verdict-sample')) {
  /* The --descriptions PASS shape from illustrative counts inside both bands. No guide is read. */
  console.log(
    JSON.stringify(
      fcaVerdict({
        mode: 'descriptions',
        D: 300,
        C: 120,
        Ck: 90,
        K: 140,
        U: 210,
        flagged: 18,
        rate: 18 / 120,
        guides: 7,
        guidesSkipped: 0,
        hits: [],
        at: '2026-09-22T00:00:00Z',
        commit: null,
        commitReason: '--verdict-sample: illustrative counts, no guide read'
      }),
      null,
      2
    )
  );
  process.exit(0);
}
if ((process.argv.includes('--selftest') || process.argv.includes('--self-test')) && isCliEntry(import.meta.url)) {
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
  /* ── .md CLAIM FILTER — every case below is a bug a PLANT found, not a case I imagined.
     The filter was pre-registered before the first run; these pin the three defects that
     pre-registration did NOT prevent, because a rate band cannot see a blind instrument. */
  eq(JSON.stringify(claimConstants('Reported at 100% of the recording')) === '["100"]', 'a bare percent is extracted — `\\b` after `%` never matches, so the commonest unit was silently missed');
  eq(JSON.stringify(claimConstants('a 5-minute rolling baseline')) === '["5"]', 'longest-first units — `min` matched before `minutes` and then failed its boundary');
  eq(claimConstants('below 90% at 1 Hz, 250 ms').join(',') === '1,250,90', 'comparator and unit branches both fire');
  eq(claimConstants('Azarbarzin 2019 validated this').length === 0, 'a citation year is not a claim');
  eq(claimConstants('cohort n=2 sites').length === 0, 'a cohort size is not a claim');
  eq(claimConstants('the 3 sensors and 12 sites').length === 0, 'a bare count is not numeral-checkable (structural, out of scope)');
  eq(
    parseGuideDescriptions('<div class="mh"><span class="ma">M</span><p class="md">below 90&#x202F;%</p></div>')[0].description === 'below 90 %',
    'descriptions share the hardened normaliser — entities decoded, not guessed'
  );
  eq(parseGuideDescriptions('<div class="mh"><span class="ma">M</span></div>').length === 0, 'card without a description is skipped');
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
  /* ── the verdict ──────────────────────────────────────────────────────────── */
  const VAT = { at: '2026-09-22T00:00:00Z', commit: null, commitReason: 'selftest' };
  const mk = (o) => fcaVerdict({ mode: 'descriptions', guides: 7, guidesSkipped: 0, hits: [], ...o, ...VAT });
  const inBand = mk({ D: 300, C: 120, Ck: 90, K: 140, U: 210, flagged: 18, rate: 18 / 120 });
  const tight = mk({ D: 300, C: 12, Ck: 9, K: 14, U: 21, flagged: 1, rate: 1 / 12 });
  const loose = mk({ D: 300, C: 120, Ck: 90, K: 140, U: 210, flagged: 60, rate: 0.5 });
  const none = mk({ D: 0, C: 0, Ck: 0, K: 0, U: 0, flagged: 0, rate: 0, guides: 3, guidesSkipped: 3 });
  eq(inBand.status === 'PASS', 'verdict: inside both bands is PASS');
  eq(
    inBand.population.eligible === 300 && inBand.population.checked === 90 && inBand.population.excluded === 210,
    'verdict: population in ONE unit: 300 descriptions = 90 checked + 180 dropped + 30 all-refused'
  );
  eq(inBand.population.eligible === inBand.population.checked + inBand.population.excluded, 'verdict: population is an equality');
  eq(tight.status === 'UNKNOWN' && /TOO TIGHT/.test(tight.reason), 'verdict: floor violated is UNKNOWN naming the band — not FAIL, the reader reads the gate name');
  eq(loose.status === 'UNKNOWN' && /TOO LOOSE/.test(loose.reason), 'verdict: ceiling violated is UNKNOWN naming the band');
  eq(/REDESIGN, not a finding/.test(tight.reason), "verdict: UNKNOWN quotes the tool's own refusal to publish");
  eq(none.status === 'NOT_RUN' && none.result === null, 'verdict: no descriptions is NOT_RUN');
  eq(/FAIL is reachable from nothing/.test(inBand.criterion.name), 'verdict: FAIL-unreachable is stated IN the object, so flags never become failures');
  const withFlag = mk({ D: 300, C: 120, Ck: 90, K: 140, U: 210, flagged: 1, rate: 1 / 120, hits: [{ guide: 'OxyDex Reference.html', name: 'ODI', missing: ['0.88'], description: 'x' }] });
  eq(
    withFlag.status === 'PASS' && withFlag.result.questions.length === 1 && withFlag.result.questions[0].missing[0] === '0.88',
    'verdict: a flag is a QUESTION in result and does not move the status'
  );
  /* formula mode: no bands, so a 50 % flag rate that would be UNKNOWN in --descriptions is a PASS with 50 % questions */
  const fm = fcaVerdict({ mode: 'formula', D: 40, C: 20, Ck: 20, K: null, U: null, flagged: 10, rate: 0.5, guides: 7, guidesSkipped: 0, hits: [], ...VAT });
  eq(
    fm.status === 'PASS' && fm.gate === 'formula-constant-audit' && /NO calibration bands/.test(fm.criterion.name),
    'verdict: formula mode has no bands — a rate that is UNKNOWN in --descriptions is PASS-with-questions here, and the object says why'
  );
  /* ── THE CORPUS ─ residue 2026-11-10-the-formula-audit-corpus-omits-the-ninth-reference-guide,
     pinned in BOTH directions. Every leg is PURE: the classifier takes a path list, so no leg reads a
     file and none spawns a process. */
  const TREE = [
    'OxyDex Reference.html',
    'PulseDex Reference.html',
    'codegen/generated/eegdex-reference.html',
    'docs/OxyDex Reference.html',
    'docs/papers/sigma-no-reference.html',
    'papers/cpap-flow-reference.html',
    'tools/formula-constant-audit.mjs'
  ];
  const cp = classifyGuidePaths(TREE);
  eq(cp.guides.length === 3, `the corpus takes the 3 node guides of 7 paths: ${cp.guides.join(' · ')}`);
  eq(cp.guides.includes('codegen/generated/eegdex-reference.html'), 'the generated guide name shape enters the corpus, which a root readdir cannot reach');
  eq(
    cp.guides.every((g) => !g.startsWith('docs/') && !g.startsWith('papers/')),
    'no served copy and no paper enters the corpus'
  );
  eq(cp.rejected.length === 3 && cp.rejected.every((r) => r.path && r.reason && r.reason.length > 8), 'every rejected path carries a named reason, so a pre-loop drop is never silent');
  eq(!cp.guides.includes('tools/formula-constant-audit.mjs') && !cp.rejected.some((r) => r.path.endsWith('.mjs')), 'a path that is no guide at all neither enters the corpus nor reads as a rejection');
  /* PLANT · the predicate this change replaced, over the same list. It answers one guide FEWER and
     holds no eegdex name at all, which is how an in-loop counter could never report the omission. */
  const rootGlob = TREE.filter((f) => /Reference\.html$/.test(f) && !f.includes('/'));
  eq(rootGlob.length === cp.guides.length - 1, `PLANT: the root predicate answers ${rootGlob.length} guide(s) where the tracked tree answers ${cp.guides.length}`);
  eq(!rootGlob.some((f) => /eegdex/i.test(f)), 'PLANT: the root predicate holds no eegdex guide, so no in-loop counter could report it');
  /* the node slug reads BOTH guide name shapes */
  eq(nodeNameFor('codegen/generated/eegdex-reference.html') === 'eegdex', 'the generated guide names its node, where `split(" ")[0]` answered the whole filename');
  eq(nodeNameFor('OxyDex Reference.html') === 'oxydex', 'a root guide still names its node');
  eq(nodeNameFor('docs/papers/sigma-no-reference.html') === 'sigma', 'the slug reads the basename and cuts at the first hyphen, never the directory');
  /* the verdict carries the pre-loop counts, and an unreadable corpus is NOT_RUN naming its reason */
  const rejV = mk({
    D: 300,
    C: 120,
    Ck: 90,
    K: 140,
    U: 210,
    flagged: 18,
    rate: 18 / 120,
    guidesRejected: 11,
    guidesNoItems: 1,
    rejections: [{ path: 'docs/OxyDex Reference.html', reason: 'a served copy' }]
  });
  eq(
    rejV.result.guidesRejected === 11 && rejV.result.guidesNoItems === 1 && rejV.result.rejections[0].reason === 'a served copy',
    'verdict: the pre-loop rejections, their reasons and the empty-guide count all reach the object'
  );
  const brokeV = mk({ D: 0, C: 0, Ck: 0, K: 0, U: 0, flagged: 0, rate: 0, guides: 0, guidesSkipped: 0, corpusError: 'git ls-files failed: boom' });
  eq(
    brokeV.status === 'NOT_RUN' && /could not be read/.test(brokeV.reason) && /boom/.test(brokeV.reason),
    'verdict: an unreadable corpus is NOT_RUN naming the reason, never an empty corpus reading as a clean sweep'
  );
  console.log(`all ${legs} selftests passed`);
  process.exit(0);
}
if (isCliEntry(import.meta.url)) process.exit(process.argv.includes('--descriptions') ? mainDescriptions() : main());
