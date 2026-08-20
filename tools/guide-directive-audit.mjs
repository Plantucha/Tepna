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
 *   node tools/guide-directive-audit.mjs --json     machine-readable
 *   node tools/guide-directive-audit.mjs --help
 * ============================================================================================== */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function main(argv) {
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

  /* ANTI-VACUITY. A scan that examined nothing reports "0 directives", which is indistinguishable
     from a clean fleet. Refuse rather than emit a well-formed zero. */
  if (census.guides < 7) {
    console.error(`REFUSE: found ${census.guides} reference guides, expected >= 7 - wrong cwd, or a guide was renamed.`);
    return 2;
  }
  if (census.lowerCards === 0 || census.withBand === 0) {
    console.error(`REFUSE: ${census.lowerCards} lower-tier cards / ${census.withBand} with bands - the card or band markup changed, so this scan proves nothing.`);
    return 2;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ census, hits }, null, 2));
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
  console.log(`\nOK: every directive-bearing lower-tier band is declared (${hits.length} hit(s), each with a recorded disclaimer)`);
  return 0;
}

/* Entry guard - this tool must not run on import. #1530 found five tools that executed on import,
   one of them release.mjs, whose main() would have proceeded toward cutting a release. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)));
