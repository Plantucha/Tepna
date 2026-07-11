/*
 * tests/csp-harness.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11 — Phase 0 interaction harness + negative control.
 *
 * The safety net for the inline-handler → event-delegation refactor. For every bundle it:
 *   1. boots the real bundle over http:// (file:// breaks 'self'/local fetch),
 *   2. captures every CSP violation (securitypolicyviolation) + page error + console error,
 *   3. best-effort POPULATES the dynamic UI (synthetic/demo) so runtime-rendered controls exist,
 *   4. scans EVERY [data-act*] element and asserts its action name is registered in
 *      DexActions._handlers — a "dead button" (a missed/renamed handler) is otherwise only
 *      found by a human clicking it. This is the regression net for the whole refactor.
 *   5. --strict only: asserts ZERO CSP violations AND runs the NEGATIVE CONTROL — an injected
 *      <script> + <img onerror> pushed through innerHTML must NOT execute under the strict CSP.
 *
 * Usage:
 *   node tests/csp-harness.mjs                 # all bundles, lenient (Phase 2 — pre-strict-CSP)
 *   node tests/csp-harness.mjs --strict        # all bundles, require 0 CSP + negative control (Phase 3/4)
 *   node tests/csp-harness.mjs --bundle OxyDex # one bundle
 *   node tests/csp-harness.mjs --bundle OxyDex --strict
 * Exit 0 = all green; exit 1 = any dead button / CSP violation / negative-control breach.
 *
 * Playwright is global (CJS); Chromium is pre-installed — paths per the environment notes.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const pw = require('/opt/node22/lib/node_modules/playwright/index.js');
const { chromium } = pw;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CHROME = (() => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  const d = readdirSync(base).find((n) => n.startsWith('chromium-'));
  return d ? join(base, d, 'chrome-linux', 'chrome') : null;
})();

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const ONE = (() => {
  const i = argv.indexOf('--bundle');
  return i >= 0 ? argv[i + 1] : null;
})();

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);

// The 10 bundles + a best-effort way to render their DYNAMIC UI so runtime controls exist.
// populate() clicks a synthetic/demo trigger if the app has one; it is best-effort (a failure
// still leaves the static scan intact). Kept minimal — the boot + static scan is the core net.
const BUNDLES = [
  { file: 'OxyDex.html', gen: 'genBtn' },
  { file: 'HRVDex.html', gen: 'genBtn' },
  { file: 'PulseDex.html', gen: 'genBtn' },
  { file: 'GlucoDex.html', gen: 'genBtn' },
  { file: 'PpgDex.html', gen: 'genBtn' },
  { file: 'ECGDex.html', gen: 'genBtn' },
  { file: 'CPAPDex.html', gen: 'demoBtn' },
  { file: 'Integrator.html', gen: null },
  { file: 'Data Unifier.html', gen: null },
  { file: 'OverDex.html', gen: null }
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = join(ROOT, p);
      if (!fp.startsWith(ROOT) || !existsSync(fp)) {
        res.writeHead(404);
        res.end('404');
        return;
      }
      try {
        const body = readFileSync(fp);
        res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
        res.end(body);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Runs in-page: scan every data-act* element and check registration; return diagnostics.
const SCAN = `(() => {
  const ATTR = { click: 'data-act', change: 'data-act-change', input: 'data-act-input', keydown: 'data-act-keydown', submit: 'data-act-submit' };
  const H = (window.DexActions && window.DexActions._handlers) || {};
  const dead = [], seen = [];
  for (const type in ATTR) {
    const a = ATTR[type];
    document.querySelectorAll('[' + a + ']').forEach((el) => {
      const name = el.getAttribute(a);
      seen.push(a + '=' + name);
      if (typeof H[name] !== 'function') dead.push({ attr: a, name, tag: el.tagName.toLowerCase(), txt: (el.textContent || '').trim().slice(0, 30) });
    });
  }
  // any surviving inline on*= handler in the LIVE DOM is a conversion miss
  const inlineLeft = [];
  document.querySelectorAll('*').forEach((el) => {
    for (const at of el.attributes) if (/^on[a-z]+$/.test(at.name)) inlineLeft.push(el.tagName.toLowerCase() + '@' + at.name + '="' + at.value.slice(0, 40) + '"');
  });
  return { hasDexActions: !!window.DexActions, count: seen.length, dead, inlineLeft, csp: (window.__csp || []).slice() };
})()`;

const NEG = `(() => {
  window.__pwned = 0;
  const host = document.createElement('div');
  document.body.appendChild(host);
  try { host.innerHTML = '<script>window.__pwned=1;<\\/script>'; } catch (e) {}
  try { host.innerHTML += '<img src=x onerror="window.__pwned=2">'; } catch (e) {}
  return true;
})()`;

async function testBundle(browser, base, b) {
  const url = base + '/' + encodeURIComponent(b.file);
  const page = await browser.newPage();
  const csp = [];
  const errors = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push((e.violatedDirective || '') + ' :: ' + (e.blockedURI || e.sourceFile || '') + (e.lineNumber ? ':' + e.lineNumber : ''));
    });
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // ignore environmental resource-load 404s (demo/sample files not served by the harness's
    // static server, favicons, …) — they are not JS-execution failures. Real uncaught exceptions
    // arrive via 'pageerror' below.
    if (/Failed to load resource|net::ERR|status of 404|ERR_/.test(t)) return;
    // CSP-violation console messages are captured STRUCTURALLY via the securitypolicyviolation
    // listener (window.__csp, read during SCAN before any injection). The console echo is redundant,
    // AND the negative control deliberately triggers one (its injected <img onerror> is blocked) —
    // counting that as a page error would fail every bundle. So drop CSP console noise here.
    if (/Content Security Policy|Refused to (execute|load|apply|run|connect)/i.test(t)) return;
    errors.push('console: ' + t.slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message || e).slice(0, 160)));

  const problems = [];
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(600);
    // best-effort populate to surface runtime-rendered controls
    if (b.gen) {
      try {
        const el = await page.$('#' + b.gen);
        if (el) {
          await el.click();
          await page.waitForTimeout(1500);
        }
      } catch (e) {
        /* best-effort */
      }
    }
    const r = await page.evaluate(SCAN);
    if (!r.hasDexActions) problems.push('DexActions global missing');
    if (r.inlineLeft.length) problems.push(r.inlineLeft.length + ' inline on*= handler(s) survive in DOM: ' + r.inlineLeft.slice(0, 6).join(' | '));
    if (r.dead.length)
      problems.push(
        r.dead.length +
          ' DEAD control(s): ' +
          r.dead
            .map((d) => d.attr + '="' + d.name + '"[' + d.txt + ']')
            .slice(0, 8)
            .join(' | ')
      );

    const cspHits = (r.csp || []).concat(csp);
    if (STRICT && cspHits.length) problems.push(cspHits.length + ' CSP violation(s): ' + cspHits.slice(0, 6).join(' | '));

    if (STRICT) {
      const before = await page.evaluate('(window.__csp||[]).length');
      await page.evaluate(NEG);
      await page.waitForTimeout(300);
      const pwned = await page.evaluate('window.__pwned');
      const after = await page.evaluate('(window.__csp||[]).length');
      if (pwned) problems.push('NEGATIVE CONTROL BREACHED — injected inline script executed (__pwned=' + pwned + ')');
      // positive proof it was CSP (a securitypolicyviolation fired for the blocked inline handler),
      // not merely innerHTML-insertion semantics.
      else if (after <= before) problems.push('NEGATIVE CONTROL WEAK — injection did not fire a CSP violation (expected the <img onerror> to be CSP-blocked)');
    }
    // hard page errors are always a problem
    if (errors.length) problems.push(errors.length + ' page error(s): ' + errors.slice(0, 4).join(' | '));

    const label = b.file + '  (' + r.count + ' data-act controls)';
    if (problems.length) console.log(paint('  ✗ ', C.red) + label + '\n      ' + problems.join('\n      '));
    else console.log(paint('  ✓ ', C.green) + label);
  } catch (e) {
    problems.push('BOOT FAILED: ' + String(e.message || e).slice(0, 200));
    console.log(paint('  ✗ ', C.red) + b.file + '\n      ' + problems.join('\n      '));
  } finally {
    await page.close();
  }
  return problems.length === 0;
}

async function main() {
  const list = ONE ? BUNDLES.filter((b) => b.file.replace(/\.html$/, '') === ONE || b.file === ONE) : BUNDLES;
  if (!list.length) {
    console.error('unknown bundle: ' + ONE);
    process.exit(2);
  }
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port;
  console.log(paint('▸ CSP interaction harness', C.bold) + paint('  (' + (STRICT ? 'STRICT — 0 CSP + negative control' : 'lenient — dead-button scan') + ')  ' + base, C.dim));
  const browser = await chromium.launch({ executablePath: CHROME || undefined, headless: true, args: ['--no-sandbox'] });
  let ok = 0;
  for (const b of list) {
    if (await testBundle(browser, base, b)) ok++;
  }
  await browser.close();
  srv.close();
  const pass = ok === list.length;
  console.log(pass ? paint('✓ ' + ok + '/' + list.length + ' bundles green', C.green) : paint('✗ ' + (list.length - ok) + '/' + list.length + ' bundle(s) failed', C.red));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
