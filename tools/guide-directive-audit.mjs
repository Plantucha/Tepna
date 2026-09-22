#!/usr/bin/env node
/* ==== guide-directive-audit - REFERENCE-GUIDE-AUDIT dimension 3, the honesty half ================
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dimension 3 asks that every normative band be either (a) a published/consensus target, cited, or
 * (b) explicitly marked relative via `no-norm-note` - no fabricated clinical cut-points. Its
 * "internal" half is gate-backed; this is the half that was NOT mechanically decidable and had to
 * be read per metric.
 *
 * WHY THIS DOES NOT MEASURE CITATIONS. Four separate citation-presence proxies were built and all
 * four were wrong - they flagged 135/166, then 68, then ~26, then 69. The proxy measures citation
 * LOCALITY, and this suite centralises citations by design, so a missing local citation is not a
 * missing source. Do not re-derive that approach; it is the most obvious thing to build here and it
 * has failed every time it was tried.
 *
 * WHAT DISCRIMINATES INSTEAD: not "is the band cited" but "does the band issue a CLINICAL DIRECTIVE
 * it has not earned". A low-tier metric telling the reader to seek care is the overclaim dimension 3
 * exists to prevent, and it is decidable from the band text alone. Of 186 lower-tier cards, 76 carry
 * a band and 53 use verdict words (Normal/Mild/Severe) - but only a handful instruct the reader to
 * ACT, and that set is small enough to actually read.
 *
 * This tool exists because #1529 published those four numbers while the script that produced them
 * lived only in /tmp. PPGDEX-ALGORITHM-DEEP-DIVE section 5 records exactly that failure - a jitter
 * bound became unverifiable because "the apparatus was never committed", and had to be re-derived
 * with a new instrument. A number whose tool is not committed is a citation, not a measurement.
 *
 *   node tools/guide-directive-audit.mjs            census + verdict (exit 1 on an undeclared hit)
 *   node tools/guide-directive-audit.mjs --json     the tepna.verdict/1 object, plus census + hits
 *   node tools/guide-directive-audit.mjs --selftest
 *   node tools/guide-directive-audit.mjs --help
 *
 * VERDICT (tepna.verdict/1, wave 2 group C — read before flipping, the rule is exact): FAIL iff >= 1
 * lower-tier band issues a clinical directive with no declared disclaimer — the same `undeclared`
 * list the exit code keys on. Population = lower-tier cards; checked = those carrying a band (the only
 * place a band directive can sit), the band-less rest excluded. The two REFUSE paths (fewer than 7
 * guides; 0 lower cards or 0 bands) are the examined-nothing shape → UNDERPOWERED with the counts, and
 * still exit 2. `--json` prints `{ …verdict, census, hits }` — a superset of the old shape.
 * ============================================================================================== */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOWER = ['emerging', 'experimental', 'heuristic'];

/* A directive tells the reader to DO something clinical. Deliberately narrow: verdict words
   (Normal/Mild/Severe) are NOT directives - 53 bands use those and they are not defects, because a
   band may legitimately grade severity relative to the reader's own nights. */
const DIRECTIVE = /\b(evaluate immediately|clinical evaluation|seek |consult|refer\b|repeat or monitor|see (?:a )?(?:doctor|physician)|medical attention|screen for|urgent|action)\b/i;
const VERDICT = /\b(normal|abnormal|mild|moderate|severe|pathologic\w*|diagnos\w*|hypox(?:ia|emia)|clinical)\b/i;

/* DECLARED EXCEPTION - ratified 2026-08-19 (#1529). This is a disclaimer record, not a suppression
   list. MOS carries the fleet's strongest directive ("Urgent sleep specialist referral") AND its
   strongest disclaimer: the card states "Not the published McGill Oximetry Score", names it as a
   pediatric tool (Brouillette/Nixon), and says "is not validated" - repeated in the badge title.
   That is dimension 3's option (b) done properly, so it passes ON ITS DISCLAIMER.
   A card may only be added here with its disclaiming text quoted in the comment. */
const DECLARED = new Map([['OxyDex MOS', 'card states "Not the published McGill Oximetry Score" and "is not validated" (#1529)']]);

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x[0-9A-Fa-f]+;|&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function auditGuides(root = REPO) {
  const guides = readdirSync(root).filter((f) => / Reference\.html$/.test(f));
  const census = { guides: guides.length, lowerCards: 0, withBand: 0, verdictBands: 0, directives: 0 };
  const hits = [];
  for (const g of guides) {
    const p = join(root, g);
    if (!existsSync(p)) continue;
    const t = readFileSync(p, 'utf8');
    /* Scan only past the last stylesheet: the <style> block defines the .ev-* classes and the
       legend strip repeats every tier name, both of which would inflate the card count. */
    const body = t.slice(t.lastIndexOf('</style>'));
    for (const card of body.split('<div class="mc"').slice(1)) {
      const tm = card.match(/ev-corner[^"']*ev-(measured|validated|emerging|experimental|heuristic)/);
      if (!tm || !LOWER.includes(tm[1])) continue;
      census.lowerCards++;
      const upTo = card.slice(0, card.indexOf('ev-corner'));
      const tbl = upTo.match(/<table class="nt"[\s\S]*?<\/table>/);
      if (!tbl) continue;
      census.withBand++;
      const text = strip(tbl[0]);
      if (VERDICT.test(text)) census.verdictBands++;
      const d = text.match(DIRECTIVE);
      if (!d) continue;
      census.directives++;
      const name = (card.match(/class="ma">([^<]+)</) || ['', '?'])[1];
      const node = g.replace(' Reference.html', '');
      hits.push({
        node,
        name,
        tier: tm[1],
        phrase: d[0],
        band: text,
        declared: DECLARED.get(node + ' ' + name) || null
      });
    }
  }
  return { census, hits, guides };
}

/* ── the verdict object — pure over { census, hits, guides }, so the selftest can drive it ───────── */
export const MIN_GUIDES = 7;
export function verdictObject({ census, hits, guides }, { commit, commitReason, at } = {}) {
  const criterion = {
    name: 'undeclared_directive_bands (lower-tier bands issuing a clinical directive with no declared disclaimer)',
    threshold: 0,
    unit: 'undeclared directive bands',
    direction: 'eq'
  };
  const base = { gate: 'guide-directive-audit', criterion, evidence: guides.slice(), tool: 'tools/guide-directive-audit.mjs', commit, commitReason, at };
  const population = { checked: census.withBand, eligible: census.lowerCards, excluded: census.lowerCards - census.withBand };
  const undeclared = hits.filter((h) => !h.declared);
  const result = { ...census, undeclared: undeclared.length, declared: hits.length - undeclared.length };
  if (census.guides < MIN_GUIDES) {
    return makeVerdict({
      ...base,
      status: 'UNDERPOWERED',
      population,
      result,
      reason: `found ${census.guides} reference guides, expected >= ${MIN_GUIDES} — wrong cwd, or a guide was renamed; the scan examined too little to decide`
    });
  }
  if (census.lowerCards === 0 || census.withBand === 0) {
    return makeVerdict({
      ...base,
      status: 'UNDERPOWERED',
      population,
      result,
      reason: `${census.lowerCards} lower-tier cards / ${census.withBand} with bands — the card or band markup changed, so this scan proves nothing`
    });
  }
  if (undeclared.length) {
    const named = undeclared.map((h) => `${h.node} ${h.name} [${h.tier}] "${h.phrase}"`);
    return makeVerdict({ ...base, status: 'FAIL', population, result, reason: `${undeclared.length} lower-tier band(s) issue a clinical directive with no declared disclaimer: ${named.join('; ')}` });
  }
  return makeVerdict({ ...base, status: 'PASS', population, result, reason: null });
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const o = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const guides = ['A Reference.html', 'B Reference.html', 'C Reference.html', 'D Reference.html', 'E Reference.html', 'F Reference.html', 'G Reference.html'];
  const census = { guides: 7, lowerCards: 186, withBand: 76, verdictBands: 53, directives: 1 };
  const mos = { node: 'OxyDex', name: 'MOS', tier: 'experimental', phrase: 'urgent', band: '…', declared: 'card states "is not validated"' };
  const clean = verdictObject({ census, hits: [mos], guides }, o);
  eq(clean.status, 'PASS', 'PASS: the one directive is declared (the #1529 MOS record)');
  eq(clean.population.checked, 76, 'checked = lower-tier cards carrying a band');
  eq(clean.population.excluded, 110, 'excluded = lower-tier cards with no band (186 − 76)');
  eq(clean.result.declared, 1, 'PASS result counts the declared hit');
  const bad = verdictObject({ census: { ...census, directives: 2 }, hits: [mos, { ...mos, node: 'PpgDex', name: 'X', declared: null, phrase: 'seek ' }], guides }, o);
  eq(bad.status, 'FAIL', 'FAIL: one undeclared directive');
  eq(/PpgDex X \[experimental\] "seek "/.test(bad.reason), true, 'FAIL reason names node, card, tier and phrase');
  eq(bad.result.undeclared, 1, 'FAIL result counts the undeclared hit');
  const few = verdictObject({ census: { ...census, guides: 3 }, hits: [], guides: guides.slice(0, 3) }, o);
  eq(few.status, 'UNDERPOWERED', 'UNDERPOWERED: 3 guides found, 7 expected (the REFUSE path)');
  eq(/found 3 reference guides, expected >= 7/.test(few.reason), true, 'UNDERPOWERED reason carries the counts');
  const noBand = verdictObject({ census: { ...census, withBand: 0, directives: 0 }, hits: [], guides }, o);
  eq(noBand.status, 'UNDERPOWERED', 'UNDERPOWERED: 0 bands — the markup changed, the scan proves nothing');
  eq(noBand.population.checked, 0, 'UNDERPOWERED over 0 bands examined nothing');
  const live = verdictObject(auditGuides(), o);
  eq(live.status === 'PASS' || live.status === 'FAIL', true, 'the real guides decide (never UNDERPOWERED in this checkout)');
  console.log(`all ${n} selftests passed`);
}

function main(argv) {
  if (argv.includes('--selftest')) {
    selftest();
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const banner = src.slice(src.indexOf('/*'), src.indexOf('*/'));
    console.log(
      banner
        .split('\n')
        .map((l) => l.replace(/^\s*\/?\*+ ?/, ''))
        .join('\n')
        .trim()
    );
    return 0;
  }
  const { census, hits, guides } = auditGuides();
  const verdict = verdictObject({ census, hits, guides });
  const json = argv.includes('--json');

  /* ANTI-VACUITY. A scan that examined nothing reports "0 directives", which is indistinguishable
     from a clean fleet. Refuse rather than emit a well-formed zero — the object says UNDERPOWERED. */
  if (verdict.status === 'UNDERPOWERED') {
    console.error(`REFUSE: ${verdict.reason}`);
    if (json) console.log(JSON.stringify({ ...verdict, census, hits }, null, 2));
    return 2;
  }

  if (json) {
    console.log(JSON.stringify({ ...verdict, census, hits }, null, 2));
  } else {
    console.log(`  guides scanned           ${census.guides}   (${guides.map((g) => g.replace(' Reference.html', '')).join(' ')})`);
    console.log(`  lower-tier cards         ${census.lowerCards}`);
    console.log(`  ...carrying a band       ${census.withBand}`);
    console.log(`  ...using verdict words   ${census.verdictBands}   (NOT defects - a band may be relative)`);
    console.log(`  ...issuing a directive   ${census.directives}`);
    console.log('');
    for (const h of hits) {
      console.log(`  ${h.declared ? 'DECLARED    ' : 'UNDECLARED  '}[${h.tier}] ${h.node} - ${h.name}   "${h.phrase}"`);
      console.log(`              ${h.declared || h.band.slice(0, 150)}`);
    }
  }

  const undeclared = hits.filter((h) => !h.declared);
  if (undeclared.length) {
    console.error(`\nFAIL: ${undeclared.length} lower-tier band(s) issue a clinical directive with no declared disclaimer.`);
    console.error('  Fix the guide (drop the directive, add a no-norm-note), or DECLARE it above with its disclaiming text quoted.');
    return 1;
  }
  (json ? console.error : console.log)(`\nOK: every directive-bearing lower-tier band is declared (${hits.length} hit(s), each with a recorded disclaimer)`);
  return 0;
}

/* Entry guard - this tool must not run on import. #1530 found five tools that executed on import,
   one of them release.mjs, whose main() would have proceeded toward cutting a release. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)));
