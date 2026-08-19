// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/* Remove an element AND ITS CONTENT from an HTML string — `<script>`/`<style>` for the tools that read
   a guide as prose.

   INDEX SCANNING, NOT A REGEX, and that is the whole point of this file existing. Three regex attempts
   shipped here, each missing a DIFFERENT legal spelling of the end tag:

     `<\/script>`      misses `</script >`    — whitespace before the `>`
     `<\/script\s*>`   misses `</script foo>` — HTML permits (and ignores) ATTRIBUTES on an END tag

   Each fix satisfied the example in the previous CodeQL alert and left the class open. That is the tell
   that the TOOL was wrong rather than the pattern — a third variant would have been a third patch. A
   scan cannot have variant gaps: find the open tag, find the next matching close, then skip to its `>`
   however it is spelled.

   THE RISK HERE IS NOT XSS — NEITHER CALLER RENDERS ANYTHING. It is SELF-DEFEAT, and it is specific:
     · guide-anchor-audit — a leaked script body regenerates exactly the seven phantom dead links this
       strip exists to remove, because a runtime-built `href="#'+target+'"` then reads as a real anchor.
     · doc-search — a leaked script body becomes SEARCHABLE TEXT, inverting that tool's stated premise
       that "the comments ARE the document": hits land in minified `for (var i = 0; ...)` instead of in
       the 278 decision-bearing lines it was built to surface.
   In both, the instrument silently re-acquires the blindness it was built to remove, and reports
   cleanly while doing it — this repo's signature defect.

   An UNCLOSED element truncates to end-of-input. That is the honest read, not a fallback: everything
   after an unterminated `<script` IS script. Returning the tail would mine executable text as prose. */
export function stripElement(html, tag) {
  const src = String(html);
  const lower = src.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}`;
  let out = '';
  let i = 0;
  for (;;) {
    const a = lower.indexOf(open, i);
    if (a === -1) return out + src.slice(i);
    /* `<scriptable>` must NOT match `<script`. A tag name ends at whitespace, `>` or `/`. */
    const after = lower[a + open.length];
    if (after !== undefined && !/[\s>/]/.test(after)) {
      out += src.slice(i, a + open.length);
      i = a + open.length;
      continue;
    }
    out += src.slice(i, a);
    const b = lower.indexOf(close, a);
    if (b === -1) return out; // unterminated: the rest of the document is inside the element
    const gt = src.indexOf('>', b);
    if (gt === -1) return out; // the end tag never closes
    i = gt + 1;
  }
}

/** Strip both element types the prose readers must never see. */
export function stripCode(html) {
  return stripElement(stripElement(html, 'script'), 'style');
}

export function selfTest() {
  let n = 0;
  const eq = (c, m) => {
    n++;
    if (!c) throw new Error(`strip-markup self-test FAILED: ${m}`);
  };
  const S = 'scr' + 'ipt';
  const leak = "href='#'+t+'";
  eq(!stripElement(`<${S}>${leak}</${S}>`, S).includes('+t+'), 'plain end tag stripped');
  eq(!stripElement(`<${S}>${leak}</${S} >`, S).includes('+t+'), 'SPACED end tag `</script >` stripped');
  eq(!stripElement(`<${S}>${leak}</${S} foo>`, S).includes('+t+'), 'ATTRIBUTED end tag `</script foo>` stripped');
  eq(!stripElement(`<${S} type="x">${leak}</${S.toUpperCase()}>`, S).includes('+t+'), 'uppercase end tag + attributed open tag stripped');
  eq(!stripElement(`<${S}>${leak}`, S).includes('+t+'), 'UNCLOSED element truncates rather than leaking its tail');
  eq(!stripElement(`<${S}>${leak}</${S}`, S).includes('+t+'), 'end tag that never closes truncates');
  /* Anti-vacuity: without these, a strip that deleted EVERYTHING would pass every leg above. */
  eq(stripElement(`<a href="#s">keep</a><${S}>${leak}</${S}>`, S).includes('keep'), 'markup BEFORE the element survives');
  eq(stripElement(`<${S}>${leak}</${S}><a href="#s">keep</a>`, S).includes('keep'), 'markup AFTER the element survives');
  eq(stripElement(`<${S}able>keep</${S}able>`, S).includes('keep'), '`<scriptable>` is NOT treated as `<script>`');
  eq(stripElement('<p>plain</p>', S) === '<p>plain</p>', 'a document with no such element is unchanged');
  eq(!stripCode('<style>.a{}</style><p>keep</p>').includes('.a{}'), 'stripCode removes <style> too');
  eq(stripCode('<style>.a{}</style><p>keep</p>').includes('keep'), 'stripCode keeps the prose');
  return n;
}

/* Guarded by RESOLVED PATH, not by `process.argv[2]` alone. A bare argv check fires on IMPORT too, so
   `guide-anchor-audit --self-test` printed this module's banner as well as its own — harmless in a
   terminal, but a second "self-test: N/N ok" line in a log is exactly the kind of stray green a reader
   miscounts as the caller's. */
/* ⚠️ THE FLAG IS `--selftest`, UNHYPHENATED, AND THAT IS LOAD-BEARING — `--self-test` is accepted only
   as an alias. Both the CI step (`tests.yml`, "Analysis-tool selftests", a `grep -rln -- '--selftest'`
   loop) and `tools/selftest-all.mjs` DISCOVER tools by that literal. This file originally spelled it
   hyphenated and used `===`, so it matched neither discovery form and was silently NOT ENROLLED: 44
   tools ran, this one never did, and its absence was indistinguishable from it passing. The CI step's
   "refuse a run finding fewer than ten" floor cannot see it either — the floor was met by the other 44.
   The banner must also read `all N selftests passed`: that is the string the runner parses for the
   COUNT, and a count is what makes a suite silently shrinking from 12 legs to 3 visible. */
if ((process.argv.includes('--selftest') || process.argv.includes('--self-test')) && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`all ${selfTest()} selftests passed`);
}
