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
 *   node tools/build-analysis.mjs --check    (diff-only; non-zero exit if any tool is stale)
 *   node tools/build-analysis.mjs --tool sensor-trio-power-analysis.html   (one tool)
 *
 * Pure / no-deps / no-network. The `.js` sibling files stay the source of truth; this only
 * rewrites the tool HTML. Re-run after editing any inlined script or worker.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const ONE = (() => {
  const i = process.argv.indexOf('--tool');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// The tool set (every *-analysis.html served surface). Kept explicit so a stray HTML never
// gets silently rewritten.
const TOOLS = [
  'cgm-hrv-coupling-analysis.html',
  'hrv-confound-analysis.html',
  'nights-icc-analysis.html',
  'odi-bias-analysis.html',
  'qrs-equiv-analysis.html',
  'qrs-yield-analysis.html',
  'sensor-trio-power-analysis.html',
  'sigma-no-reference-analysis.html',
  'treatment-response-analysis.html'
];

const readFile = (f) => readFileSync(join(ROOT, f), 'utf8');
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
  const src = readFile(workerFile);
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
  for (const d of deps) parts.push('/* ==== ' + d + ' ==== */\n' + readFile(d));
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
    return '<script data-inline-src="' + src + '">\n' + readFile(src) + '\n</script>';
  });
  // re-fill existing inline blocks (idempotent regen) — but NOT our own worker shim
  html = html.replace(/<script\b[^>]*\bdata-inline-src="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi, (full, name) => {
    if (name === '__file-local-workers') return full; // handled separately
    if (!exists(name)) return full;
    return '<script data-inline-src="' + name + '">\n' + readFile(name) + '\n</script>';
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
    html = html.replace(/(<script\b[^>]*\bdata-inline-src=)/i, shim + '\n$1');
  }
  return html;
}

// ── run ──────────────────────────────────────────────────────────────────────────────────
const targets = ONE ? [ONE] : TOOLS;
const stale = [];
const wrote = [];
for (const t of targets) {
  if (!exists(t)) {
    console.error('  ! missing tool: ' + t);
    continue;
  }
  const orig = readFile(t);
  const next = bundle(orig);
  if (next === orig) continue;
  if (CHECK) stale.push(t);
  else {
    writeFileSync(join(ROOT, t), next);
    wrote.push(t);
  }
}

if (CHECK) {
  if (stale.length) {
    console.error('STALE (' + stale.length + '): ' + stale.join(', '));
    console.error('run: node tools/build-analysis.mjs');
    process.exit(1);
  }
  console.log('analysis tools current — ' + targets.length + ' checked, all self-contained');
} else {
  console.log('bundled ' + wrote.length + ' of ' + targets.length + ' tool(s)' + (wrote.length ? ': ' + wrote.join(', ') : ' (all current)'));
}
