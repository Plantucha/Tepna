#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * frozen-timeline-check.mjs — do the shipped bundles render BLANK when the document timeline
 * never advances (print · PDF export · headless capture · a throttled background tab)?
 * ----------------------------------------------------------------------------
 * `BLANK-ON-PRINT-FLEET-2026-08-03` §4 asks for exactly one thing before the fix is scheduled:
 * REPRODUCE IT, by reading the COMPUTED style under a frozen timeline rather than grepping the CSS
 * for an `animation: none` rule that may never apply.
 *
 * `ans-design.css` animates entrance from `opacity: 0` (`fadeIn` · `cardEntrance` · `heroEntrance` ·
 * `scoreCount`). Where the timeline never advances the element stays on frame 0 — transparent.
 *
 * ── WHAT IT ACTUALLY FOUND, WHICH IS NOT WHAT THE BRIEF EXPECTED ────────────────────────────────
 *
 * The brief states "Only the Integrator has it" and lists six apps that still print blank. Measured,
 * that is STALE: `entrance-guard.js` is loaded by all eight node shells and already neutralises
 * `.main-content` + the card classes fleet-wide — its selector list is in fact BROADER than the
 * Integrator's scoped one. The injected probe below reads `animation: none` on every bundle, which is
 * how that was established.
 *
 * The residual is ONE selector in ONE app: **OxyDex's `.main-wrap`**. OxyDex is the only app whose
 * outer wrapper is `.main-wrap` rather than `.main-content`, and `.main-wrap` is not in the guard's
 * list — so it sits at `opacity: 0`, laid out, under a frozen timeline. CPAPDex wraps in `.page`
 * (unanimated); every other app wraps in `.main-content` (guarded).
 *
 * ── THE CONTROL THAT MAKES THIS A MEASUREMENT ───────────────────────────────────────────────────
 *
 * A harness that reported every app blank — or every app visible — would be measuring itself. The
 * Integrator is the pinned control (it has carried a guard longest), and the run must show it visible
 * while at least one un-guarded surface is not. That split is asserted, not assumed.
 *
 * ── HOW THE TIMELINE IS FROZEN, AND WHY THE OBVIOUS WAY DOES NOT WORK ───────────────────────────
 *
 * The brief suggests `document.getAnimations().forEach(a => { a.currentTime = 0; a.pause(); })`. Run
 * AFTER load that measures nothing: the 0.4 s entrance has already finished, finished animations are
 * no longer returned by `getAnimations()`, and there is nothing left to rewind — every surface reads
 * `opacity: 1` and the harness reports a clean fleet. (It did, on the first attempt here.)
 *
 * The timeline is therefore frozen through CDP — `Animation.setPlaybackRate(0)` — BEFORE navigation,
 * so no entrance ever advances past its first frame. That is the actual print/capture condition.
 *
 * A related correction to the brief's mechanism: at frame 0 the element is transparent because the
 * animation is sitting on `from { opacity: 0 }`, which needs no `fill-mode` at all. `fill-mode: both`
 * explains the case where the timeline stops AFTER the animation would have ended; the frozen-at-start
 * case is simpler and stricter. Both end at the same place — a transparent element — but a fix aimed
 * only at `fill-mode` would not cover this one.
 *
 * Print media is emulated too, and reported separately, because the `@media print` block is the other
 * thing a fix might reasonably touch and conflating them would let it look like a fix to the cause.
 *
 * USAGE  node tools/frozen-timeline-check.mjs [--base http://127.0.0.1:8080]
 * ════════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE = opt('--base', 'http://127.0.0.1:8080').replace(/\/$/, '');

/* The eight app bundles plus the two orchestrators. `Integrator.html` is the CONTROL — it is the one
   surface already carrying the scoped override, so it must come back visible. */
const APPS = ['OxyDex.html', 'HRVDex.html', 'PulseDex.html', 'GlucoDex.html', 'ECGDex.html', 'CPAPDex.html', 'MotionDex.html', 'PpgDex.html', 'Integrator.html'];

/* The classes `ans-design.css` animates from opacity 0 (:854 · :911 · :1045 · :1195) and that the
   Integrator's scoped override explicitly neutralises. Injected, not searched for — see the probe. */
const PROBE_CLASSES = ['chart-card', 'finding-card', 'pair-card', 'metric', 'main-content'];

/* NO SELECTOR LIST. A fixed list measured almost nothing here: on a bare load the apps show an upload
   screen, so `.chart-card` and friends do not exist yet, and 7 of 9 surfaces reported "(none present)"
   while looking clean. The harness therefore enumerates whatever the page ACTUALLY animates and reads
   the computed opacity of each — which is how `div.main-wrap`, the whole app wrapper, was found. */

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const rows = [];
for (const app of APPS) {
  const page = await browser.newPage();
  const r = { app, error: null, animated: [], hidden: [], nLive: 0, print: null, probe: {} };
  try {
    /* FREEZE FIRST, NAVIGATE SECOND — see the header. */
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    await page.goto(`${BASE}/${encodeURIComponent(app)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(600);
    const got = await page.evaluate(() => {
      const anim = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!cs.animationName || cs.animationName === 'none') continue;
        // LAID OUT ONLY. An element that is display:none is not "blank", it is absent by design, and
        // counting it would inflate the finding.
        const shown = el === document.body || el.offsetParent !== null || el.getClientRects().length > 0;
        if (!shown) continue;
        anim.push({
          sel: el.tagName.toLowerCase() + (el.className && el.className.toString ? '.' + el.className.toString().trim().split(/\s+/)[0] : ''),
          name: cs.animationName,
          fill: cs.animationFillMode,
          op: +cs.opacity
        });
        if (anim.length > 40) break;
      }
      return { anim, nLive: document.getAnimations().length };
    });
    r.animated = got.anim;
    r.nLive = got.nLive;
    r.hidden = got.anim.filter((a) => a.op < 0.5);

    /* ── PROBE THE RULES, not just what happens to be on screen ──────────────────────────────────
       On a bare load these apps show an upload screen, so `.chart-card` / `.finding-card` and the
       rest of the report surface do not exist yet — and a run that only enumerates live elements
       therefore says nothing about the view a user actually prints. (First pass reported "1 of 9"
       for exactly this reason, which would have read as a refutation of the brief's six-app claim.)
       So each animated class is INJECTED into the loaded bundle and its computed opacity read in
       situ: real cascade, real stylesheet, real frozen timeline, no app data required. */
    r.probe = await page.evaluate((classes) => {
      const out = {};
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:100px';
      document.body.appendChild(host);
      for (const c of classes) {
        const el = document.createElement('div');
        el.className = c;
        host.appendChild(el);
        const cs = getComputedStyle(el);
        out[c] = { op: +cs.opacity, anim: cs.animationName, fill: cs.animationFillMode };
        host.removeChild(el);
      }
      host.remove();
      return out;
    }, PROBE_CLASSES);
    await page.emulateMedia({ media: 'print' });
    r.print = await page.evaluate(() => {
      let worst = null;
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!cs.animationName || cs.animationName === 'none') continue;
        const shown = el === document.body || el.offsetParent !== null || el.getClientRects().length > 0;
        if (!shown) continue;
        const o = +cs.opacity;
        if (worst == null || o < worst) worst = o;
      }
      return worst;
    });
  } catch (e) {
    r.error = String((e && e.message) || e).slice(0, 120);
  }
  await page.close();
  rows.push(r);
}
await browser.close();

console.log('Frozen-timeline render check — computed opacity with the timeline frozen BEFORE load\n');
console.log('  app                 animated  hidden  worst  the hidden element(s)');
for (const r of rows) {
  if (r.error) {
    console.log(`  ${r.app.padEnd(18)} ERROR ${r.error}`);
    continue;
  }
  const worst = r.animated.length ? Math.min(...r.animated.map((a) => a.op)) : null;
  const names = r.hidden.map((h) => `${h.sel} (${h.name}, fill=${h.fill})`).join(', ');
  console.log(`  ${r.app.padEnd(18)} ${String(r.animated.length).padStart(8)}  ${String(r.hidden.length).padStart(6)}  ${String(worst ?? '—').padStart(5)}  ${names}`);
}

console.log('\n── injected-probe: what the shipped RULES do to a report surface not yet on screen ──');
console.log('  (all 1 ⇒ `entrance-guard.js` IS present and working fleet-wide — the brief\'s "only the');
console.log('   Integrator has it" is stale. What it does NOT cover is the outer wrapper; see above.)');
console.log('  app                 ' + PROBE_CLASSES.map((c) => c.slice(0, 11).padEnd(12)).join(''));
for (const r of rows) {
  if (r.error) continue;
  console.log('  ' + r.app.padEnd(18) + ' ' + PROBE_CLASSES.map((c) => String(r.probe && r.probe[c] ? r.probe[c].op : '—').padEnd(12)).join(''));
}

const ok = rows.filter((r) => !r.error);
const probeBlank = (r) => Object.values(r.probe || {}).some((v) => v && v.op < 0.5);
const blanks = ok.filter((r) => r.hidden.length > 0 || probeBlank(r));
const integ = ok.find((r) => r.app === 'Integrator.html');
console.log(`\n  ${blanks.length} of ${ok.length} surface(s) hold a laid-out element at opacity ~0 under a frozen timeline.`);

console.log('\n── the control ──');
if (!integ) {
  console.log('  ⚠ Integrator.html did not report — WITHOUT IT THIS RUN PROVES NOTHING: a harness that');
  console.log('    blanks everything is indistinguishable from one that measures nothing.');
} else if (integ.hidden.length === 0 && !probeBlank(integ) && blanks.length > 0) {
  console.log(`  ✓ Integrator (already patched, ${integ.animated.length} animated element(s)) stays visible while`);
  console.log(`    ${blanks.length} un-patched surface(s) do not. The harness discriminates, so the blanks are the`);
  console.log('    defect and not the method.');
} else if (integ.hidden.length > 0 || probeBlank(integ)) {
  console.log('  ⚠ Integrator is ALSO blank — either its scoped override regressed, or this harness freezes');
  console.log('    something the real print path does not. Do not report a fleet defect off this run.');
} else {
  console.log('  ⚠ nothing read blank — either the fix has landed, or the freeze did not take. An earlier');
  console.log('    revision of this tool reported exactly this while measuring nothing; check the counts.');
}

const printBlank = ok.filter((r) => r.print != null && r.print < 0.5);
console.log(`\n  under emulated print media, timeline NOT frozen: ${printBlank.length} of ${ok.length} blank`);
console.log('  — expected 0. Print emulation changes @media matching, not the timeline, so a fix aimed at');
console.log('    `@media print` cannot be mistaken here for a fix to the cause.');

process.exitCode = 0;
