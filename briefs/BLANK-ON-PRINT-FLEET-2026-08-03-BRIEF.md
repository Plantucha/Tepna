<!--
  BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-03 · **Spawned-by:** `AUDIT-FOLLOWUPS-BRIEF.md` §4.1 (re-verified live 2026-08-03) · **Affects:** `ans-design.css` (spine — inlined into EVERY bundle) or the six `*-render.js` · **⚠️ Serializes against all other bundle work**

# Six apps still print blank, and the fix is a spine change that has to be scheduled

## 1 · The defect, re-verified in code 2026-08-03

`ans-design.css` starts its entrance animations from `opacity: 0` and pins them with `fill-mode: both`:

```css
@keyframes cardEntrance { from { opacity: 0; transform: translateY(12px) scale(.98); } … }
.chart-card { animation: cardEntrance .4s ease both; }   /* :854 */
.chart-svg  { animation: fadeIn .4s ease .05s both; }    /* :911 */
/* also :1045, :1195 */
```

`fill-mode: both` means the element holds the **`from`** state until the animation's timeline advances.
Where the document timeline is **frozen or never started** — print, PDF export, headless capture, a
throttled background tab — it never advances, so the element stays at `opacity: 0` and the surface
renders **blank**.

**This is not a hypothesis.** The Integrator was patched for exactly this, and its patch names the
mechanism (`integrator-render.js:29-37`):

```css
/* …leaves content invisible if the document timeline is frozen/throttled
   (preview capture, print, PDF export, background tab). Pin the end-state as
   the base so the app is ALWAYS visible… */
.main-content{ animation:none !important; opacity:1 !important; transform:none !important; }
#kpiStrip.show, #kpiStrip .kpi, .chart-card, .finding-card, .pair-card, .metric{ animation:none !important; opacity:1 !important; }
```

**Only the Integrator has it.** OxyDex · HRVDex · PulseDex · GlucoDex · ECGDex · CPAPDex (and MotionDex)
still inherit the un-neutralised rules.

**Neither existing guard covers it.** `ans-design.css` has exactly two `@media print` rules and the only
substantive one is `#exportBar{display:none !important}` (:2389) — it does not touch the animations.
`prefers-reduced-motion` (:240) sets `animation-duration: .01ms !important`, which *does* rescue that one
user preference (a .01 ms animation lands on the `to` state immediately) — but it fires only when the
user has that preference set, and print/capture is not that.

## 2 · Why this is worth fixing rather than living with

A user printing or PDF-exporting their own health report gets **blank cards** — no error, no partial
render, just missing content where a number should be. It is also the failure mode least likely to be
reported, because the person seeing it assumes they did something wrong.

## 3 · Two routes — pick deliberately, both serialize

**(a) Root fix in `ans-design.css` — correct, widest blast radius.** Make the *visible end-state the
base* and animate *from* hidden only while playing, rather than relying on `fill-mode` to hold a hidden
start. One edit, fixes every current and future app by construction, and deletes the Integrator's scoped
workaround rather than multiplying it. ⚠️ `ans-design.css` is inlined into **every** bundle, so this moves
**every** app's `manifestHash` → all bundles rebuild → every `provenance/<App>.json` re-stamps. Per
`CLAUDE.md` §👥.3 this is spine work: **say so before starting, and land it when no other bundle work is
in flight.**

**(b) Replicate the Integrator's scoped override into the six `*-render.js`.** Smaller per-file diff and
skips the orchestrators — but it is still 6 bundles, and it makes the workaround permanent in seven
places instead of fixing the cause once. **(a) is recommended**; (b) only if the fleet re-bundle cannot be
scheduled and the blank pages need stopping now.

**Do not** fold this into a "§6 sweep" as `AUDIT-FOLLOWUPS` §4.1 suggested — that §6 is obsolete
(source↔bundle drift is now a standing gate, `build.mjs --check`). This needs its own scheduled pass.

## 4 · How to prove it, before and after

The gate this repo keeps wishing it had is one that could actually fail. Assert the *computed* style
under a frozen timeline rather than the presence of a CSS rule:

- **Reproduce first.** Load a bundle, do not let the animation run (or call
  `document.getAnimations().forEach(a => { a.currentTime = 0; a.pause(); })`), then read
  `getComputedStyle(document.querySelector('.chart-card')).opacity`. Pre-fix it reads `0`.
- **Fix, then re-read** — it must read `1`. That is the assertion; a source scan for `animation: none`
  would pass on a rule that never applies.
- Also check `@media print` via `matchMedia('print')` where the runner supports it.

## 5 · Carried from the same parent — NOT this brief's work, but do not lose it

`AUDIT-FOLLOWUPS` §4.2: the 🔴 evidence-badge **coverage mandate** was only made compliant in the
Integrator; OxyDex/HRVDex/PulseDex/GlucoDex/ECGDex/CPAPDex have never been audited for unbadged
surfaces. That is a genuine mandate gap (`CLAUDE.md` §🎫: an unbadged number reaching a user's eye is a
bug of the same severity as a wrong unit) and deserves its own brief. It would ride the same fleet
re-bundle, so consider scheduling the two together.

## Done when

- [ ] Route (a) or (b) chosen by the owner, and the fleet re-bundle scheduled against other in-flight work.
- [ ] The blank is **reproduced** under a frozen timeline before the fix, and shown gone after — computed
      `opacity`, not a source scan.
- [ ] A gate asserts the computed end-state, verified by re-applying the defect (it must red).
- [ ] If (a): the Integrator's scoped override is **deleted**, not left shadowing the fix.
- [ ] All bundles rebuilt, every `provenance/<App>.json` re-stamped, GATE A/B green, `--check` clean.

## Cross-references
- Parent: `AUDIT-FOLLOWUPS-BRIEF.md` §4.1 · original source `INTEGRATOR-EXPORT-FIX-BRIEF.md` secondary list.
- Code: `ans-design.css` :217 · :221 · :854 · :911 · :1045 · :1195 · :240 · :2389 ·
  `integrator-render.js` :29-37 (the working patch and its rationale).
- `CLAUDE.md` §👥.3 (spine changes serialize) · §🔏 (re-bundle + provenance) · §🎫 (the §5 badge mandate).
