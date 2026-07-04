/*
 * tests/browser-gates.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless-browser CI gate. The Node suite (tests/run-tests.mjs) covers logic;
 * this drives the two BROWSER-only gates a headless runner can't otherwise see:
 *   1. Dex-Test-Suite.html  — full assertion suite + render-coverage (boots all
 *      8 app bundles in iframes, confirms computed values reach the DOM).
 *   2. verify-provenance.html — GATE A: each committed bundle's plain-inline manifestHash
 *      matches BUILD-MANIFEST.json; GATE B: every ledger fixture is reproducible.
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
// --disable-dev-shm-usage: CI containers give /dev/shm only ~64 MB. Render-coverage boots 9 self-
// contained app bundles (each evals MBs of inlined plain-text JS) in an iframe; that overflows /dev/shm
// and the RENDERER PROCESS CRASHES mid-run — which surfaces as an EARLY waitForFunction rejection
// (~30 s in), NOT a 5-min stall. Routing Chromium shared memory to /tmp removes the crash. (Local runs
// have a large /dev/shm, which is why the suite is green there but red in CI.)
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

/* ── Gate 1 · Dex-Test-Suite (assertions + render-coverage) ───────────────── */
async function gateTestSuite() {
  const page = await ctx.newPage();
  let crashed = false;
  page.on('pageerror', (e) => console.log('   [suite page error]', e.message));
  page.on('crash', () => { crashed = true; console.log('   [suite] RENDERER CRASHED (page "crash" event) — almost always /dev/shm OOM booting the app bundles'); });
  console.log('▸ Dex-Test-Suite.html …');
  // ?full is REQUIRED: render-coverage is ON-DEMAND (lazy, 2026-06-30). A bare open paints only the
  // headless floor and never boots the rigs → __rcState stays 'pending' and the wait below times out.
  await page.goto(BASE + '/Dex-Test-Suite.html?full', { waitUntil: 'load', timeout: 60000 });
  // Read the suite's OWN programmatic verdict (CLAUDE.md: window.__rcState + sameOriginStatus(), never
  // scrape prose). Render-coverage is complete iff __rcState === 'done'. (The old predicate waited for
  // the literal words "hang guard" in #results — brittle, and it hid the real failure mode below.)
  try {
    // CI runners are meaningfully slower than a local/dev machine for this rig (shared vCPUs, plus
    // --disable-dev-shm-usage routes iframe boot memory through disk instead of tmpfs) — the ~30-50s
    // local runtime observed a full clean pass with zero boot-skips; the codebase's own retry-once
    // boot logic + this 5-min ceiling were already CI headroom over that baseline. A run that reaches
    // 'running' with groups still legitimately accumulating (no crash, no thrown error) and just needs
    // more wall-clock is NOT the same failure mode as a genuine hang; widen the ceiling so a slow-but-
    // progressing CI runner doesn't red on wall-clock alone (BROWSER-GATES-CI-TIMEOUT 2026-07-03).
    await page.waitForFunction(() => window.__rcState === 'done', { timeout: 900000 });
  } catch (err) {
    // waitForFunction rejects on EITHER a genuine 5-min stall OR an early execution-context loss
    // (renderer crash). Distinguish them and report the state actually reached, so the next run is
    // actionable instead of the old blanket "did not finish within 5 min" that masked the crash.
    let diag = null;
    try {
      diag = await page.evaluate(() => {
        const s = (window.sameOriginStatus && window.sameOriginStatus()) || {};
        return { rcState: window.__rcState || 'unknown', rcGroups: s.renderCoverageGroups || 0,
                 bootSkips: window.__rcBootSkips || [], blocked: !!s.blocked, rcTimings: window.__rcTimings || [] };
      });
    } catch (_) { /* context gone → almost certainly a crash */ }
    if (crashed || !diag) {
      FAILS.push('Dex-Test-Suite: renderer CRASHED during render-coverage' +
        (diag ? ' (reached rcState=' + diag.rcState + ', ' + diag.rcGroups + ' rc groups)' : ' (execution context lost)') +
        ' — this is a CI /dev/shm OOM; chromium must launch with --disable-dev-shm-usage (see launch args above).');
    } else {
      FAILS.push('Dex-Test-Suite: render-coverage did not reach done within 15 min — rcState=' +
        diag.rcState + ', ' + diag.rcGroups + ' rc groups booted, bootSkips=' + JSON.stringify(diag.bootSkips) +
        (diag.blocked ? ', same-origin BLOCKED' : '') + '. Per-rig timings (ms) so far: ' + JSON.stringify(diag.rcTimings) +
        ' — a rig missing from this list is the one that was still in-flight when the ceiling hit.');
    }
    try { await page.close(); } catch (_) {}
    return;
  }
  const r = await page.evaluate(() => ({
    hasFail: !!document.querySelector('#summary .pill.fail'),
    bootSkips: window.__rcBootSkips || [],
    summary: (document.getElementById('summary').innerText || '').replace(/\s+/g, ' ').trim(),
  }));
  console.log('   summary:', r.summary + (r.bootSkips.length ? '   [boot-skips: ' + r.bootSkips.join(', ') + ']' : ''));
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
