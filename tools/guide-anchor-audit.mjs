#!/usr/bin/env node
/*
 * tools/guide-anchor-audit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * REFERENCE-GUIDE-AUDIT dimension 5, mechanised — the third sibling of `severity-ladder-audit.mjs`
 * (dim 3) and `formula-constant-audit.mjs` (dim 2). Dimension 5 asks that nothing in a guide points at
 * nothing: every `href="#x"` resolves to a real `id`, no `id` is duplicated, every section is reachable
 * from the nav, and every abbreviation in the section map is both defined and points somewhere real.
 *
 * WHY THIS ONE EARNS A TOOL: the defect it finds is created by REMOVING things. `BP`/`SBP`/`DBP` pointed
 * at a `profile` section deleted on 2026-06-23 when the BP-projection metric was hard-nulled — the
 * section went, the jump-links did not, and a reader clicking them in the abbreviation index went
 * nowhere for two months. Nothing else in the repo can see that: the metric registry has no opinion on
 * anchors, and `cohesion-badges` walks cards, not links.
 *
 * ⚠️ SCRIPTS ARE EXCLUDED, AND THAT IS NOT OPTIONAL. A first pass reported one dead anchor in EVERY
 * guide, all identical: `href="#'+target+'"` — a runtime-built href inside a `<script>`, i.e. JavaScript
 * string concatenation, not markup. Seven false positives from one missing exclusion. Anything matching
 * markup patterns must strip `<script>` blocks first or it is reading code as content.
 *
 * ⚠️ DECODE BEFORE COMPARING KEYS. The abbreviation list stores `SpO₂`, the section map may store
 * the same key differently, and a naive comparison reports both as "mapped but undefined". Measured: an
 * un-decoded pass claimed 6 undefined entries where exactly 1 was real — five were escape artefacts.
 * The tool decodes `\uXXXX` and `&#xNN;` on BOTH sides before comparing.
 *
 *     node tools/guide-anchor-audit.mjs            # sweep every guide
 *     node tools/guide-anchor-audit.mjs --selftest
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { selfTest as stripSelfTest, stripElement } from './strip-markup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function decodeKey(t) {
  return String(t)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)));
}

/* Delegates to the shared index scanner. It used to be a regex HERE, and it was wrong three times —
   each fix satisfied the previous CodeQL example and left the class open (`</script >`, then
   `</script foo>`). See `tools/strip-markup.mjs` for why scanning replaced pattern-matching and what a
   leak costs this specific tool: the seven phantom dead links it was built to remove. */
export function stripScripts(html) {
  return stripElement(html, 'script');
}

export function auditGuide(html) {
  const body = stripScripts(html);
  const ids = new Set([...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const allIds = new Set([...String(html).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const hrefs = [...body.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const dead = [...new Set(hrefs.filter((h) => !ids.has(h)))].sort();
  const dup = [...ids].filter((i) => (body.match(new RegExp(`\\bid="${i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length > 1);

  /* Abbreviation index: keys decoded on both sides, targets checked against the FULL id set (a jump may
     legitimately target a section whose id lives inside a scripted region of the document). */
  const abbrsRaw = /\babbrs\s*=\s*\[([\s\S]*?)\]\s*;/.exec(html);
  const mapRaw = /abbrSectionMap\s*=\s*\{([\s\S]*?)\}\s*;/.exec(html);
  const defined = new Set(abbrsRaw ? [...abbrsRaw[1].matchAll(/\["([^"]+)"/g)].map((m) => decodeKey(m[1])) : []);
  const mapped = mapRaw ? [...mapRaw[1].matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)].map((m) => [decodeKey(m[1]), m[2]]) : [];
  const undefinedAbbr = mapped.filter(([k]) => defined.size && !defined.has(k)).map(([k]) => k);
  const deadAbbr = mapped.filter(([, v]) => !allIds.has(v));

  return { links: hrefs.length, ids: ids.size, dead, dup, abbrs: defined.size, mapped: mapped.length, undefinedAbbr, deadAbbr };
}

function main() {
  const guides = readdirSync(ROOT)
    .filter((f) => /Reference\.html$/.test(f))
    .sort();
  let bad = 0;
  console.log(`DENOMINATOR: ${guides.length} guide(s)\n`);
  for (const g of guides) {
    const r = auditGuide(readFileSync(join(ROOT, g), 'utf8'));
    const n = r.dead.length + r.dup.length + r.undefinedAbbr.length + r.deadAbbr.length;
    bad += n;
    console.log(
      `  ${g.padEnd(26)} ${String(r.links).padStart(4)} links · ${String(r.ids).padStart(3)} ids · ${String(r.abbrs).padStart(3)} abbrs · ${String(r.mapped).padStart(3)} mapped · ${n} defect(s)`
    );
    if (r.dead.length) console.log(`        DEAD LINK      : ${JSON.stringify(r.dead.slice(0, 6))}`);
    if (r.dup.length) console.log(`        DUPLICATE id   : ${JSON.stringify(r.dup.slice(0, 6))}`);
    if (r.undefinedAbbr.length) console.log(`        MAPPED, UNDEFINED: ${JSON.stringify(r.undefinedAbbr.slice(0, 6))}`);
    if (r.deadAbbr.length) console.log(`        ABBR -> MISSING id: ${JSON.stringify(r.deadAbbr.slice(0, 6))}`);
  }
  console.log(`\n${bad} dimension-5 defect(s) across ${guides.length} guide(s).`);
  return bad === 0 ? 0 : 1;
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
  let legs = 0;
  const eq = (c, m) => {
    legs++;
    if (!c) {
      console.error('SELF-TEST FAIL: ' + m);
      process.exit(1);
    }
  };
  const q = String.fromCharCode(34);
  eq(stripScripts(`<a href=${q}#real${q}></a><scr${'ipt'}>x='#'+t</scr${'ipt'}>`).includes('#real'), 'markup survives script strip');
  eq(!stripScripts(`<scr${'ipt'}>href=${q}#'+t+'${q}</scr${'ipt'}>`).includes("'+t+'"), 'runtime-built href is NOT read as markup');
  eq(!stripScripts(`<scr${'ipt'}>href=${q}#'+t+'${q}</scr${'ipt'} >`).includes("'+t+'"), 'SPACED closing tag </script > is still stripped');
  eq(!stripScripts(`<scr${'ipt'}>href=${q}#'+t+'${q}</scr${'ipt'} foo>`).includes("'+t+'"), 'ATTRIBUTED closing tag </script foo> is stripped');
  eq(stripSelfTest() === 12, "the shared scanner's own 12 legs pass");
  eq(!stripScripts(`<a href=${q}#s${q}></a><scr${'ipt'}>href=${q}#'+t+'${q}`).includes("'+t+'"), 'UNCLOSED script truncates rather than leaking its tail');
  eq(stripScripts(`<a href=${q}#s${q}></a><scr${'ipt'}>x</scr${'ipt'}>`).includes('#s'), 'real markup before a script survives');
  eq(decodeKey('SpO\\u2082') === 'SpO₂', 'backslash-u decoded');
  eq(decodeKey('SpO&#x2082;') === 'SpO₂', 'numeric entity decoded');
  const good = auditGuide(`<a href=${q}#s${q}></a><div id=${q}s${q}></div>`);
  eq(good.dead.length === 0 && good.dup.length === 0, 'clean doc reports clean');
  const dead = auditGuide(`<a href=${q}#gone${q}></a><div id=${q}s${q}></div>`);
  eq(dead.dead.length === 1 && dead.dead[0] === 'gone', 'dead link found');
  const dupd = auditGuide(`<div id=${q}s${q}></div><div id=${q}s${q}></div>`);
  eq(dupd.dup.length === 1, 'duplicate id found');
  console.log(`all ${legs} selftests passed`);
  process.exit(0);
}
if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) process.exit(main());
