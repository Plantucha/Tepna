/*
 * tests/browser-gates.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless-browser CI gate. The Node suite (tests/run-tests.mjs) covers logic;
 * this drives the two BROWSER-only gates a headless runner can't otherwise see:
 *   1. Dex-Test-Suite.html  — full assertion suite + render-coverage (boots all
 *      8 app bundles in iframes, confirms computed values reach the DOM).
 *   2. verify-provenance.html — each bundle exposes a buildHash helper (GATE A)
 *      and every committed uploads/*.json fixture is reproducible (GATE B).
 *
 * Detection is by polling the pages' own DOM verdicts — no page edits needed.
 *
 * NOTE on uploads/: it is gitignored (personal data), so on a fresh CI checkout
 * the provenance FIXTURE audit (GATE B) has nothing to scan and passes vacuously;
 * GATE A (all 8 bundles reproducible) is still fully enforced. Locally, with
 * uploads/ present, both gates run. The Dex-Test-Suite gate never needs uploads/.
 *
 * Run: BASE_URL=http://127.0.0.1:8080 node tests/browser-gates.mjs
 */
import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const FAILS = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

/* ── Gate 1 · Dex-Test-Suite (assertions + render-coverage) ───────────────── */
async function gateTestSuite() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [suite page error]', e.message));
  console.log('▸ Dex-Test-Suite.html …');
  // ?full is REQUIRED: render-coverage is ON-DEMAND (lazy, 2026-06-30). A bare open paints only the
  // headless floor and never boots the rigs (no "hang guard" group) → the wait below would time out.
  await page.goto(BASE + '/Dex-Test-Suite.html?full', { waitUntil: 'load', timeout: 60000 });
  // The oxy-hang group is pushed LAST; wait for it + a settled summary pill.
  try {
    await page.waitForFunction(() => {
      const res = document.getElementById('results');
      const sum = document.querySelector('#summary .pill.pass, #summary .pill.fail');
      return !!res && /hang guard/i.test(res.innerText || '') && !!sum;
    }, { timeout: 300000 });
  } catch {
    FAILS.push('Dex-Test-Suite: did not finish within 5 min (render-coverage iframes stalled?)');
    await page.close(); return;
  }
  const r = await page.evaluate(() => ({
    hasFail: !!document.querySelector('#summary .pill.fail'),
    summary: (document.getElementById('summary').innerText || '').replace(/\s+/g, ' ').trim(),
  }));
  console.log('   summary:', r.summary);
  if (r.hasFail) FAILS.push('Dex-Test-Suite RED — ' + r.summary);
  await page.close();
}

/* ── Gate 2 · verify-provenance (build manifest + fixture audit) ──────────── */
async function gateProvenance() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [provenance page error]', e.message));
  console.log('▸ verify-provenance.html …');
  await page.goto(BASE + '/verify-provenance.html', { waitUntil: 'load', timeout: 60000 });
  // Manifest appends one row per bundle (8). Wait for all, then a short settle
  // so the (best-effort) fixture audit finishes too.
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('#manifest tbody tr').length >= 8,
      { timeout: 180000 });
  } catch {
    FAILS.push('verify-provenance: build manifest did not populate all 8 bundles');
    await page.close(); return;
  }
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const reds = [...document.querySelectorAll(
      '#manifest .pill.bad, #manifest td.bad, #fixtures .pill.bad, #fixtures td.bad')];
    return {
      bundles: document.querySelectorAll('#manifest tbody tr').length,
      fixtures: document.querySelectorAll('#fixtures tbody tr').length,
      reds: reds.map((e) => (e.closest('tr')?.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 30),
    };
  });
  console.log(`   ${out.bundles} bundles · ${out.fixtures} fixtures audited`);
  if (out.reds.length) FAILS.push('verify-provenance RED verdicts:\n   - ' + out.reds.join('\n   - '));
  await page.close();
}

await gateTestSuite();
await gateProvenance();
await browser.close();

if (FAILS.length) {
  console.error('\n✕ BROWSER GATES FAILED:\n' + FAILS.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('\n✓ browser gates passed (render-coverage + provenance)');
