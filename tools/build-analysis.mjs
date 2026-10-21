/*
 * tools/build-analysis.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Make the science/analysis tools SELF-CONTAINED single-file HTML, so they run when a
 * user downloads ONE .html to disk and opens it over file:// — the way the bundled apps
 * already do. The tools were the last surfaces that still loaded logic from external
 * <script src="x.js"> siblings and spun web-workers with `new Worker('x.js')`; both are
 * forbidden by the browser under file:// (opaque origin — `SecurityError` / `Failed to
 * fetch`, verified empirically), so a downloaded tool loaded a shell that did nothing.
 *
 * This bundler, per tool HTML:
 *   1. INLINES every external <script src="x.js"> → <script data-inline-src="x.js">…</script>
 *      (idempotent: an already-inlined block is re-filled from the current x.js — same marker
 *      convention as the owned app bundler, tools/build-core.js).
 *   2. Rewrites `new Worker('w.js')` → a BLOB-URL worker whose source has the worker's own
 *      importScripts deps inlined ahead of its body (importScripts is a no-op in the blob —
 *      file:// can't load siblings). A blob worker runs fine under file:// + the no-network CSP
 *      (worker-src blob:), verified empirically.
 *   3. Leaves the CSP as-is: once everything is inline, `default-src … 'unsafe-inline' … blob:`
 *      already covers the inline scripts + blob workers (exactly what makes the apps work).
 *
 * The data-loading `fetch('sibling')` "load by path" flow still can't run under file:// (no
 * origin) — but every tool's PRIMARY input is drag-drop (FileReader), which works offline, so
 * the tool is fully usable from a download. The fetch path degrades to its existing error.
 *
 *   node tools/build-analysis.mjs            (bundle all tools in place)
 *   node tools/build-analysis.mjs --check    (diff-only; non-zero exit if any tool is stale OR fails the artifact audit)
 *   node tools/build-analysis.mjs --tool sensor-trio-power-analysis.html   (one tool)
 *   node tools/build-analysis.mjs --check --json   (stdout is ONE tepna.verdict/1; prose → stderr)
 *   node tools/build-analysis.mjs --selftest (the artifact audit's negative controls)
 *
 * Pure / no-deps / no-network. The `.js` sibling files stay the source of truth; this only
 * rewrites the tool HTML. Re-run after editing any inlined script or worker.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { elementBlocks } from './strip-markup.mjs';
import { makeVerdict } from './verdict-emit.mjs';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ESM-MIGRATION Phase 2: a co-loaded DSP may be a dual-mode ES module (top-level export) — a classic
// inline <script> cannot carry that syntax, so every JS inlined here is classicified first (no-op on
// classic files; the DSP's IIFE + window attaches are untouched). Same bridge the test runners use.
const DexBuild = createRequire(import.meta.url)(join(ROOT, 'tools', 'build-core.js'));
const CHECK = process.argv.includes('--check');
const JSON_OUT = process.argv.includes('--json');
const SELFTEST = process.argv.includes('--selftest');
/* With --json, stdout is the verdict object and NOTHING else — the adoption gate parses it. Prose
   then goes to stderr, where a human still reads it. An error line is always stderr. */
const say = (line, err) => {
  (err || JSON_OUT ? process.stderr : process.stdout).write(line + '\n');
};
const ONE = (() => {
  const i = process.argv.indexOf('--tool');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// The tool set (every *-analysis.html served surface). Kept explicit so a stray HTML never
// gets silently rewritten.
const TOOLS = [
  /* not an analysis tool — a shared realm page. It is here because it loads node DSPs, and those
     carry ES re-exports a classic <script src> cannot parse; inlining through `readJs` classicifies
     them. See the comment block in the file. */
  'cohort-harness.html',
  'cgm-hrv-coupling-analysis.html',
  'hrv-confound-analysis.html',
  'nights-icc-analysis.html',
  'odi-bias-analysis.html',
  /* PAT Feasibility.html was a hand-copied page (2026-07-25) that loaded pat-gate.js + pat-feasibility.js from
     the served root, whose worker then importScripts seven more — and the box's sync-apps serves only OWNED
     output, so every one of them 404'd there and the monitor's PAT click could never process (Wren, 2026-09-21).
     pat-feasibility-worker.js had said "DEAD in the build-analysis blob" since it was written: built to be
     inlined, never listed. */
  'PAT Feasibility.html',
  /* Listed the day it was written, which is the whole lesson of the entry above: the box serves only
     OWNED output, so a page absent from here 404s every dep it names and the monitor's click can never
     process. It runs the SAME worker as `PAT Feasibility.html`, so the blob is built identically. */
  'PAT Classic vs Fused.html',
  'qrs-equiv-analysis.html',
  'qrs-yield-analysis.html',
  'resp-acc-analysis.html',
  'sensor-trio-power-analysis.html',
  /* the monitor's "3 corner hat" click lands here (2026-09-22): one night, solved and drawn on the suite's own
     engines, instead of the power tool whose simulation panels stay empty for a single night. Same worker, so it
     is bundled the same way — a page not in this list is never inlined and never served (see the PAT entry). */
  'sensor-trio-night.html',
  'sigma-no-reference-analysis.html',
  'treatment-response-analysis.html'
];

const readFile = (f) => readFileSync(join(ROOT, f), 'utf8');
// JS destined for a classic inline block or a blob worker: shed any top-level import/export first.
const readJs = (f) => DexBuild.classicify(readFile(f));
const exists = (f) => existsSync(join(ROOT, f));

// A permissive worker-context DOM/window shim, hoisted ahead of the inlined deps. The production
// DSP wrappers touch `window.*` / `document.*` / localStorage at top-level load; a worker has none,
// so the hand-written workers install this BEFORE importScripts. We must do the same before the
// inlined deps (a worker that already installs its own copy just re-installs it — idempotent).
// Mirrors cohort-worker.js installDomShim (the most complete of the four workers).
const WORKER_DOM_SHIM = [
  'if (typeof self.window === "undefined" || typeof self.document === "undefined") { (function () {',
  '  var stub = new Proxy(function () {}, {',
  '    get: function (t, p) { if (p === "outerHTML" || p === "innerHTML") return ""; if (p === Symbol.toPrimitive || p === "toString") return function () { return ""; }; return stub; },',
  '    set: function () { return true; }, apply: function () { return stub; }, construct: function () { return stub; }, has: function () { return true; } });',
  '  var doc = new Proxy({}, { get: function (t, p) {',
  '      if (p === "getElementById" || p === "querySelector" || p === "querySelectorAll" || p === "createElement" || p === "getElementsByClassName" || p === "getElementsByTagName") return function () { return stub; };',
  '      if (p === "documentElement" || p === "head" || p === "body") return stub;',
  '      if (p === "addEventListener" || p === "removeEventListener") return function () {};',
  '      if (p === "cookie") return ""; return stub; }, set: function () { return true; }, has: function () { return true; } });',
  '  self.document = doc; self.window = self;',
  '  if (typeof self.navigator === "undefined") self.navigator = { userAgent: "analysis-worker" };',
  '  self.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };',
  '  self.matchMedia = function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {} }; };',
  '})(); }'
].join('\n');

// ── worker-source assembly: inline a worker's importScripts deps ahead of its body ──────────
//   A blob worker cannot importScripts a file:// sibling, so we prepend the dep sources and
//   neutralise importScripts. Deps = every existing sibling '*.js' literal the worker names
//   (covers static importScripts(...) AND `var SCRIPTS=[…]` / `{k:[…]}` map forms), first-seen
//   order (base libs are listed before the DSPs that need them). Cached across tools.
const workerCache = new Map();
function workerSource(workerFile) {
  if (workerCache.has(workerFile)) return workerCache.get(workerFile);
  // Strip the served-only ESM co-load fallback (marked @blob-strip in the workers). It is DEAD
  // here — deps are pre-inlined and importScripts is a no-op stub that never throws — and its
  // XMLHttpRequest token would red the no-network static lens (transport primitive) in every
  // tool that inlines the worker. A rethrow keeps the catch honest if the impossible happens.
  const src = readFile(workerFile).replace(/\/\* @blob-strip:start[\s\S]*?@blob-strip:end \*\//g, 'throw e; /* build-analysis: served-only co-load fallback stripped (deps pre-inlined) */');
  const deps = [];
  const seen = new Set();
  const re = /['"]([\w.-]+\.js)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const f = m[1];
    if (f === workerFile || seen.has(f) || !exists(f)) continue;
    seen.add(f);
    deps.push(f);
  }
  // The production DSP wrappers assign `window.XDSP = …` at load; a worker has no `window`. The
  // hand-written workers shim it (`self.window = self`) BEFORE their importScripts — so hoist the
  // same shim to the very top of the blob source, ahead of the inlined deps (idempotent with any
  // shim already inside the worker body, which then no-ops).
  const parts = ['/* build-analysis: blob-worker source — deps inlined, importScripts neutralised (file://-safe) */', WORKER_DOM_SHIM, 'self.importScripts = function () {};'];
  for (const d of deps) parts.push('/* ==== ' + d + ' ==== */\n' + readJs(d));
  parts.push('/* ==== ' + workerFile + ' ==== */\n' + src);
  const assembled = parts.join('\n;\n') + '\n';
  workerCache.set(workerFile, assembled);
  return assembled;
}

// ── the injected runtime shim: a __WSRC map + a __mkWorker() factory ─────────────────────────
const SHIM_OPEN = '<script data-inline-src="__file-local-workers">';
const SHIM_CLOSE = '</script>';
function shimBlock(workerFiles) {
  const map = {};
  for (const w of workerFiles) map[w] = workerSource(w);
  // JSON.stringify safely escapes the worker sources into JS string literals.
  const body =
    '/* build-analysis: file://-safe blob workers (local-download fix). A worker constructed from a ' +
    'sibling .js path throws under file:// (opaque origin); these run from a Blob instead. */\n' +
    'var __WSRC = ' +
    JSON.stringify(map) +
    ';\n' +
    'function __mkWorker(name){ return new Worker(URL.createObjectURL(new Blob([__WSRC[name]], {type:"application/javascript"}))); }\n';
  return SHIM_OPEN + body + SHIM_CLOSE;
}

// ── inline one <script src> / re-fill one data-inline-src block from the current file ────────
function inlineScripts(html) {
  // external src → data-inline-src (skip anything already inline)
  html = html.replace(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)><\/script>/gi, (full, pre, src, post) => {
    if (/\bdata-inline-src=/i.test(pre + post)) return full; // already an inline block's label
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) return full; // external URL / data: — leave
    if (!exists(src)) return full; // unknown sibling — leave (surfaces as a real 404, not our concern)
    return '<script data-inline-src="' + src + '">\n' + readJs(src) + '\n</script>';
  });
  // re-fill existing inline blocks (idempotent regen) — but NOT our own worker shim
  html = html.replace(/<script\b[^>]*\bdata-inline-src="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi, (full, name) => {
    if (name === '__file-local-workers') return full; // handled separately
    if (!exists(name)) return full;
    return '<script data-inline-src="' + name + '">\n' + readJs(name) + '\n</script>';
  });
  // <link rel="stylesheet" href="x.css"> → <style data-inline-src="x.css"> (the build-core convention), and
  // re-fill existing inline style blocks. A tool that links the design system must CARRY it: linked, it opens
  // unstyled from a download (file://) and 404s on the box, which serves no loose CSS for the analysis tools.
  html = html.replace(/<link\b([^>]*?)\brel="stylesheet"([^>]*?)\bhref="([^"]+)"([^>]*)>/gi, (full, a, b, href) => {
    if (/^(https?:)?\/\//i.test(href) || /^data:/i.test(href)) return full; // external URL — leave
    if (!exists(href)) return full; // unknown sibling — leave (surfaces as a real 404, not our concern)
    return '<style data-inline-src="' + href + '">\n' + readFile(href) + '\n</style>';
  });
  html = html.replace(/<style\b[^>]*\bdata-inline-src="([^"]+)"[^>]*>[\s\S]*?<\/style>/gi, (full, name) => {
    if (!exists(name)) return full;
    return '<style data-inline-src="' + name + '">\n' + readFile(name) + '\n</style>';
  });
  return html;
}

// ── rewrite `new Worker('x.js')` → `__mkWorker('x.js')` and collect the worker files ────────
function rewriteWorkers(html) {
  const workers = new Set();
  const out = html.replace(/new\s+Worker\(\s*(['"])([\w.-]+\.js)\1\s*\)/g, (full, q, file) => {
    if (!exists(file)) return full;
    workers.add(file);
    return "__mkWorker('" + file + "')";
  });
  // idempotency: a prior run already rewrote to __mkWorker('x.js') — collect those too so the
  // re-injected shim still covers them (the `new Worker` form is gone after the first bundle).
  let m;
  const re = /__mkWorker\(\s*(['"])([\w.-]+\.js)\1\s*\)/g;
  while ((m = re.exec(out))) if (exists(m[2])) workers.add(m[2]);
  return { html: out, workers: [...workers] };
}

function bundle(html) {
  // strip any prior shim first (idempotent) so we re-inject a fresh one — consume the trailing
  // newline we injected with it, so repeated runs don't accumulate blank lines.
  html = html.replace(new RegExp(SHIM_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + SHIM_CLOSE + '\\n?', 'i'), '');
  html = inlineScripts(html);
  const rw = rewriteWorkers(html);
  html = rw.html;
  if (rw.workers.length) {
    // inject the shim right before the FIRST inlined tool script so __mkWorker exists in time
    const shim = shimBlock(rw.workers);
    /* ⚠️ A REPLACER FUNCTION, NEVER A REPLACEMENT STRING. `shim` is ~1.9 MB of somebody else's source
       text, and `String.prototype.replace` interprets `$&`, `` $` ``, `$'` and `$n` inside a replacement
       STRING. `oxydex-dsp.js` carries the comment ``only the anchored `$` keeps them apart`` — perfectly
       ordinary prose about a regex anchor — and the `` $` `` in it expanded to THE ENTIRE DOCUMENT
       PREFIX, splicing `<!DOCTYPE html>…` into the middle of the `var __WSRC = {…}` string literal. The
       literal never closed, the block was a SyntaxError, `__mkWorker` was never defined, and all four
       tools that inline `oxydex-dsp.js` hung forever at "booting … realms" with `window.<RESULT>` never
       appearing. Measured 2026-09-28: 4 of 11 blob-worker tools, all spliced at the identical offset.
       A function replacement receives the groups as arguments and interprets nothing. */
    html = html.replace(/(<script\b[^>]*\bdata-inline-src=)/i, (_m, p1) => shim + '\n' + p1);
  }
  return html;
}

/* ── THE ARTIFACT AUDIT — assertions about the SERVED BYTES, not about the generator ─────────────
 * `--check` re-bundles and byte-compares, so the only thing it can decide is that THIS generator
 * reproduces what the tree holds: a generator compared to itself. The one defect that ever shipped
 * from here passed exactly that test — the writer spliced the document into the worker map (the ⚠️
 * comment in `bundle` has the mechanism), four pages shipped a SyntaxError, and a re-bundle of the
 * same source reproduced the same broken bytes byte for byte. Residue
 * `2026-09-28-generator-compared-to-itself-examines-no-artifact`.
 *
 * These legs read the artifact and know nothing about how it was made:
 *   L1 self-document  no inlined block may carry the page's own first SELF_HEAD_LEN bytes. The
 *                     detector is the page's OWN signature, never value membership: `oxydex-dsp.js`
 *                     builds a literal '<!DOCTYPE html>' on purpose, and a membership test flags 6
 *                     blocks in today's tree (CLAUDE.md §∅ — detect against the stream's own
 *                     distribution, never against a value).
 *   L2 size band      a block whose `data-inline-src` names an existing file must sit inside
 *                     RATIO_BAND of that file's bytes. Measured 2026-10-20 over 69 sourced blocks
 *                     (38 distinct files): 0.9999–1.0013. The only legal way past 1.0 is the two
 *                     newlines the writer wraps the body in, which is why the upper bound is 1.02 —
 *                     it holds for any source of 100 bytes or more, and the smallest one inlined
 *                     here is 1495. Downward there is no such bound: classicify strips top-level
 *                     import/export, so a dual-mode module may legitimately inline shorter, and the
 *                     lower bound only has to catch a truncation. A splice is orders of magnitude,
 *                     not percent — the shipped defect carried 1.9 MB into one block.
 *   L3 worker map     the injected `__WSRC` map must PARSE as JSON, every `__mkWorker('x.js')` name
 *                     on the page must be a key of it, and no entry may be empty. This is the leg
 *                     the shipped defect fails: the spliced literal never closed.
 *
 * Populations are reported, never assumed. A block whose `data-inline-src` names no file on disk is
 * `synthetic` (the worker shim, and any inlined asset whose source has since moved), and a block
 * carrying a non-classic `type=` is COUNTED as `moduleTyped` rather than guessed at — the same split
 * `readInlineParseCensus` publishes for the app bundles.
 */
export const SELF_HEAD_LEN = 200;
export const RATIO_BAND = { lo: 0.5, hi: 1.02 };
const WSRC_RE = /var __WSRC =\s*([\s\S]*?);\nfunction __mkWorker\b/;
const MKWORKER_RE = /__mkWorker\(\s*(['"])([\w.-]+\.js)\1\s*\)/g;

const attrOf = (attrs, name) => {
  const m = new RegExp('\\b' + name + '="([^"]*)"', 'i').exec(attrs);
  return m ? m[1] : null;
};

/* The one scan: `strip-markup.mjs`'s element walker, the same one the test runner's parse census
   uses, so this audit and that census cannot disagree about what a block IS. */
function inlineBlocks(html) {
  const out = [];
  for (const tag of ['script', 'style']) {
    for (const b of elementBlocks(html, tag)) {
      const name = attrOf(b.attrs, 'data-inline-src');
      if (name !== null) out.push({ tag, name, type: attrOf(b.attrs, 'type'), body: b.body });
    }
  }
  return out;
}

/** auditArtifact(html, { sizeOf }) → { blocks, sourced, synthetic, moduleTyped, ratios, findings, workerNames, workerKeys } */
export function auditArtifact(html, opts = {}) {
  const sizeOf = opts.sizeOf || ((f) => (exists(f) ? readFile(f).length : null));
  const sig = html.slice(0, SELF_HEAD_LEN);
  const findings = [];
  const ratios = [];
  let sourced = 0;
  let synthetic = 0;
  let moduleTyped = 0;
  const blocks = inlineBlocks(html);
  for (const b of blocks) {
    if (b.type && !/^(?:text|application)\/javascript$/i.test(b.type) && b.tag === 'script') moduleTyped += 1;
    if (sig.length === SELF_HEAD_LEN && b.body.includes(sig)) {
      findings.push({ leg: 'self-document', block: b.name, detail: "the block carries the page's own first " + SELF_HEAD_LEN + ' bytes' });
    }
    const n = sizeOf(b.name);
    if (n == null) {
      synthetic += 1;
      continue;
    }
    sourced += 1;
    if (n === 0) {
      findings.push({ leg: 'size-band', block: b.name, detail: 'the source file is empty, so no ratio exists' });
      continue;
    }
    const ratio = b.body.length / n;
    ratios.push(ratio);
    if (ratio < RATIO_BAND.lo || ratio > RATIO_BAND.hi) {
      findings.push({ leg: 'size-band', block: b.name, detail: 'ratio ' + ratio.toFixed(3) + ' is outside ' + RATIO_BAND.lo + '–' + RATIO_BAND.hi });
    }
  }
  /* L3 — the worker map. `named` is what the PAGE asks for; `keys` is what the map can serve. */
  const named = [...new Set([...html.matchAll(MKWORKER_RE)].map((m) => m[2]))];
  const shim = blocks.find((b) => b.name === '__file-local-workers');
  let keys = null;
  if (named.length && !shim) {
    findings.push({ leg: 'worker-map', block: '__file-local-workers', detail: 'the page names ' + named.length + ' blob worker(s) and carries no map' });
  } else if (shim) {
    const m = WSRC_RE.exec(shim.body);
    let map = null;
    if (!m) {
      findings.push({ leg: 'worker-map', block: '__file-local-workers', detail: 'no `var __WSRC = {…};` literal — the block is not the map it claims to be' });
    } else {
      try {
        map = JSON.parse(m[1]);
      } catch (e) {
        findings.push({ leg: 'worker-map', block: '__file-local-workers', detail: 'the map does not parse as JSON — ' + String(e.message || e).slice(0, 80) });
      }
    }
    if (map && typeof map === 'object') {
      keys = Object.keys(map);
      for (const w of named) {
        if (!keys.includes(w)) findings.push({ leg: 'worker-map', block: '__file-local-workers', detail: w + ' is constructed on the page and is not a key of the map' });
      }
      for (const k of keys) {
        if (typeof map[k] !== 'string' || map[k].length === 0) findings.push({ leg: 'worker-map', block: '__file-local-workers', detail: k + ' has an empty source' });
      }
    }
  }
  return { blocks: blocks.length, sourced, synthetic, moduleTyped, ratios, findings, workerNames: named.length, workerKeys: keys === null ? null : keys.length };
}

/* ── SELFTEST — the negative control lives here, so the detector is proven on every CI run ───────
   A detector that has never seen the defect is a claim. Each leg below plants one defect in a
   synthetic page and asserts THIS audit names it; the clean legs assert it stays silent, including
   on the `'<!DOCTYPE html>'` literal that a value-membership detector flags. Discovered, not
   listed: `tools/selftest-all.mjs` and CI's selftest loop find this by the `--selftest` handler. */
function selftest() {
  let ran = 0;
  let fail = 0;
  const ok = (cond, label) => {
    ran += 1;
    if (!cond) {
      fail += 1;
      console.error('  ✗ ' + label);
    }
  };
  const HEAD =
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<title>artifact-audit fixture — a head deliberately longer than the signature the self-document leg reads, so the fixture exercises the real comparison</title>';
  const page = (body) => HEAD + '</head><body>\n' + body + '\n</body></html>\n';
  const block = (name, body, extra) => '<script data-inline-src="' + name + '"' + (extra || '') + '>\n' + body + '\n</script>';
  const sizes = { 'a.js': 1000, 'empty.js': 0 };
  const A = (html) => auditArtifact(html, { sizeOf: (f) => (Object.hasOwn(sizes, f) ? sizes[f] : null) });
  const legs = (r, leg) => r.findings.filter((f) => f.leg === leg).length;

  const clean = page(block('a.js', 'x'.repeat(900)));
  const sig = clean.slice(0, SELF_HEAD_LEN);
  ok(sig.length === SELF_HEAD_LEN, 'fixture · the head is longer than the signature');
  let r = A(clean);
  ok(r.findings.length === 0, 'clean · a page whose only block is its own source has no finding');
  ok(r.blocks === 1 && r.sourced === 1 && r.synthetic === 0, 'clean · populations: 1 block, 1 sourced, 0 synthetic');
  ok(r.ratios.length === 1 && r.ratios[0] > RATIO_BAND.lo && r.ratios[0] < RATIO_BAND.hi, 'clean · the ratio is inside the band');

  r = A(page(block('a.js', 'x'.repeat(450) + sig + 'x'.repeat(450))));
  ok(legs(r, 'self-document') === 1, 'L1 · a block carrying the document prefix is named');
  r = A(page(block('a.js', "var _parserSource = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;" + 'x'.repeat(830))));
  ok(r.findings.length === 0, "L1 · a legitimate '<!DOCTYPE html>' literal is NOT a finding (value membership is the wrong detector)");

  ok(legs(A(page(block('a.js', 'x'.repeat(100)))), 'size-band') === 1, 'L2 · a truncated block is outside the band');
  ok(legs(A(page(block('a.js', 'x'.repeat(2000)))), 'size-band') === 1, 'L2 · a block larger than its source is outside the band');
  ok(legs(A(page(block('empty.js', 'x'))), 'size-band') === 1, 'L2 · an empty source has no ratio and is reported');
  r = A(page(block('nosuch.js', 'x'.repeat(50))));
  ok(r.synthetic === 1 && r.sourced === 0 && r.findings.length === 0, 'L2 · a block with no source file is synthetic, not a finding');
  ok(A(page(block('a.js', 'x'.repeat(900), ' type="module"'))).moduleTyped === 1, 'population · a non-classic type is counted, never guessed');

  const shim = (map) => block('__file-local-workers', 'var __WSRC = ' + JSON.stringify(map) + ';\nfunction __mkWorker(name){ return name; }');
  const call = '\n<script data-inline-src="t.js">\n__mkWorker(\'w.js\');\n</script>';
  r = A(page(shim({ 'w.js': 'self.onmessage = function () {};' }) + call));
  ok(r.findings.length === 0 && r.workerNames === 1 && r.workerKeys === 1, 'L3 · a map that serves every worker the page names has no finding');
  r = A(page(block('__file-local-workers', 'var __WSRC = {"w.js": "' + sig + ';\nfunction __mkWorker(name){ return name; }') + call));
  ok(legs(r, 'worker-map') === 1, 'L3 · the shipped defect: a spliced map does not parse as JSON');
  ok(legs(r, 'self-document') === 1, 'L3 · the same splice also fires the self-document leg');
  ok(legs(A(page(shim({ 'other.js': 'x' }) + call)), 'worker-map') === 1, 'L3 · a worker the page constructs and the map lacks is named');
  ok(legs(A(page(shim({ 'w.js': '' }) + call)), 'worker-map') === 1, 'L3 · an empty worker source is named');
  ok(legs(A(page(block('t.js', "__mkWorker('w.js');"))), 'worker-map') === 1, 'L3 · a page that names a worker and carries no map is named');
  ok(A(page(block('a.js', 'x'.repeat(900)))).workerKeys === null, 'L3 · a page with no workers reports no map, not an empty one');

  /* The verdict is part of the contract, so build one of each reachable status here. */
  for (const s of ['PASS', 'FAIL', 'NOT_RUN']) {
    let built = null;
    try {
      built = verdictOf({
        status: s,
        audited: s === 'NOT_RUN' ? [] : ['x.html'],
        eligible: 1,
        missing: s === 'NOT_RUN' ? ['x.html'] : [],
        stale: s === 'FAIL' ? ['x.html'] : [],
        findings: s === 'FAIL' ? [{ tool: 'x.html', leg: 'self-document', block: 'a.js', detail: 'fixture' }] : [],
        totals: { blocks: 1, sourced: 1, synthetic: 0, moduleTyped: 0 },
        ratios: [0.9]
      });
    } catch (e) {
      console.error('  ✗ verdict ' + s + ' — ' + String(e.message || e));
    }
    ok(built !== null && built.status === s, 'verdict · a ' + s + ' object validates under verdict.js');
  }

  console.log(fail ? fail + ' failed of ' + ran : 'all ' + ran + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

// ── the verdict (tepna.verdict/1, CLAUDE.md §🧾) ─────────────────────────────────────────────
/* ONE object for what `--check` decides, which is two things about the same page set: it is
   REGENERABLE (this generator reproduces the tree) and its blocks are SOUND (the audit above).
   Both are defects of a served page, so both count against one pre-stated threshold of zero. */
function verdictOf({ status, audited, eligible, missing, stale, findings, totals, ratios }) {
  const lo = ratios.length ? Math.min(...ratios) : null;
  const hi = ratios.length ? Math.max(...ratios) : null;
  const r3 = (v) => (v == null ? null : +v.toFixed(3));
  return makeVerdict({
    gate: 'analysis-tool-artifacts',
    tool: 'tools/build-analysis.mjs',
    status,
    population: { checked: audited.length, eligible, excluded: missing.length },
    criterion: {
      name: 'no-served-analysis-page-is-stale-or-carries-a-defective-inline-block',
      threshold: 0,
      unit: 'defective pages',
      direction: 'eq'
    },
    result: audited.length
      ? {
          pages: audited.length,
          stale,
          findings,
          blocks: totals.blocks,
          sourced: totals.sourced,
          synthetic: totals.synthetic,
          moduleTyped: totals.moduleTyped,
          ratioBand: RATIO_BAND,
          ratioMin: r3(lo),
          ratioMax: r3(hi)
        }
      : null,
    evidence: ['tools/build-analysis.mjs'].concat(audited),
    reason:
      status === 'PASS'
        ? null
        : status === 'NOT_RUN'
          ? 'no analysis page was readable — ' + missing.length + ' of ' + eligible + ' missing from the tree'
          : [stale.length ? stale.length + ' page(s) stale against this generator' : null, findings.length ? findings.length + ' artifact finding(s)' : null].filter(Boolean).join('; '),
    at: new Date().toISOString()
  });
}

// ── run ──────────────────────────────────────────────────────────────────────────────────
if (SELFTEST && isCliEntry(import.meta.url)) selftest();

const targets = ONE ? [ONE] : TOOLS;
const stale = [];
const wrote = [];
const missing = [];
const refused = [];
const audited = [];
const findings = [];
const ratios = [];
const totals = { blocks: 0, sourced: 0, synthetic: 0, moduleTyped: 0 };
for (const t of targets) {
  if (!exists(t)) {
    missing.push(t);
    say('  ! missing tool: ' + t, true);
    continue;
  }
  const orig = readFile(t);
  const next = bundle(orig);
  /* The audit judges the ARTIFACT: under --check the bytes the tree holds (what a reader downloads),
     on a write the bytes this run is about to ship. A page that fails its own audit is NEVER
     WRITTEN — the defect this closes was a writer shipping a page it had broken. */
  const a = auditArtifact(CHECK ? orig : next);
  audited.push(t);
  for (const k of Object.keys(totals)) totals[k] += a[k];
  for (const r of a.ratios) ratios.push(r);
  for (const f of a.findings) findings.push({ tool: t, ...f });
  if (next === orig) continue;
  if (CHECK) stale.push(t);
  else if (a.findings.length) {
    refused.push(t);
    say('  ! refusing to write ' + t + ' — it fails the artifact audit', true);
  } else {
    writeFileSync(join(ROOT, t), next);
    wrote.push(t);
  }
}

const status = audited.length === 0 ? 'NOT_RUN' : stale.length + findings.length ? 'FAIL' : 'PASS';
if (JSON_OUT) process.stdout.write(JSON.stringify(verdictOf({ status, audited, eligible: targets.length, missing, stale, findings, totals, ratios }), null, 1) + '\n');

if (findings.length) {
  say('ARTIFACT FINDINGS (' + findings.length + '):', true);
  for (const f of findings) say('  ' + f.tool + ' · ' + f.leg + ' · ' + f.block + ' — ' + f.detail, true);
}
if (CHECK) {
  if (stale.length) {
    say('STALE (' + stale.length + '): ' + stale.join(', '), true);
    say('run: node tools/build-analysis.mjs', true);
  }
  if (!stale.length && !findings.length) {
    say('analysis tools current — ' + audited.length + ' checked, all self-contained');
    /* `--check` compares the WORKING TREE, so it says "current" the moment the writer has run — even
       when the commit does not carry the regenerated files. That asymmetry has now shipped a
       half-staged commit twice (the v1.14.0 release PR, and again while landing DEEP-AUDIT-II §6.2),
       both caught only by CI or by hand. Say so here, where the misleading "current" is printed. */
    say('  (this compares the working tree — `git status` is what tells you the COMMIT carries them)');
    say(
      '  artifact audit: ' +
        totals.blocks +
        ' inline block(s) — ' +
        totals.sourced +
        ' sourced, ' +
        totals.synthetic +
        ' synthetic, ' +
        totals.moduleTyped +
        ' module-typed; size ratios ' +
        (ratios.length ? Math.min(...ratios).toFixed(3) + '–' + Math.max(...ratios).toFixed(3) : 'none') +
        ' against band ' +
        RATIO_BAND.lo +
        '–' +
        RATIO_BAND.hi
    );
  }
} else {
  say(
    'bundled ' +
      wrote.length +
      ' of ' +
      targets.length +
      ' tool(s)' +
      (wrote.length ? ': ' + wrote.join(', ') : refused.length ? '' : ' (all current)') +
      (refused.length ? ' — ' + refused.length + ' REFUSED by the artifact audit, left as they were' : '')
  );
  /* Print the exact stage line for what THIS run wrote — the same contract build-docs.mjs adopted in
     #236. A tool is the only honest place to say which paths it touched; a caller reconstructing that
     list by hand is how files get left unstaged. Explicit paths only, never `git add -A` (§👥.2). */
  if (wrote.length) {
    const q = (p) => (/\s/.test(p) ? `"${p}"` : p);
    say('\nStage exactly what this run wrote:\n    git add ' + wrote.map(q).sort().join(' '));
  }
}
if (stale.length || findings.length) process.exit(1);
