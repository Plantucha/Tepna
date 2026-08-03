<!--
  BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-03 (**fixed and gated** — see §1-RESULT-II. §1-RESULT was right that the fleet claim was stale, but under-counted the residual: it was **two** selectors across **four** apps (`.main-wrap` in OxyDex/HRVDex/PulseDex, and `.kpi` in CPAPDex, which has no `#kpiStrip` at all). Both guarded; the guard now has a gate that DERIVES its expectation from `ans-design.css`, verified by 5 mutants. `ans-design.css` itself is deliberately UNTOUCHED — the mitigation stays in `entrance-guard.js`) · **Created:** 2026-08-03 · **Spawned-by:** `AUDIT-FOLLOWUPS-BRIEF.md` §4.1

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

## §1-RESULT — REPRODUCED 2026-08-03, and the fleet claim is STALE

`tools/frozen-timeline-check.mjs` ships with this entry and does what §4 asks: freezes the timeline and
reads the **computed** opacity, never greps for a rule.

**How the timeline is frozen matters, and §4's suggestion does not work.** Running
`getAnimations().forEach(a => { a.currentTime = 0; a.pause(); })` *after* load measures nothing — the
0.4 s entrance has already finished, finished animations are no longer returned by `getAnimations()`,
and there is nothing left to rewind. The first attempt here did exactly that and reported a clean fleet.
The tool now freezes through CDP `Animation.setPlaybackRate(0)` **before navigation**, which is the real
print/capture condition. (A related correction: at frame 0 the element is transparent because the
animation sits on `from{opacity:0}` — no `fill-mode` required. `fill-mode: both` describes the *other*
case, a timeline stopping after the animation would have ended. A fix aimed only at `fill-mode` would
miss the frozen-at-start one.)

### The measured fleet

| app | wrapper | animated + laid out at opacity 0 |
|---|---|---|
| **OxyDex** | `.main-wrap` | **YES — `div.main-wrap` (`fadeIn`), opacity 0** |
| HRVDex · PulseDex · GlucoDex · ECGDex · MotionDex · PpgDex | `.main-content` | no |
| CPAPDex | `.page` (unanimated) | no |
| Integrator | `.main-content` | no (control) |

**"Only the Integrator has it" is false.** `entrance-guard.js` — a shared drop-in loaded by all **eight**
node `.src.html` shells — already pins `.main-content` plus `#kpiStrip.show · .kpi · .chart-card ·
.chart-svg · .tab-content.active · .readiness-* · .finding-card · .pair-card · .metric`. Its list is
in fact **broader** than the Integrator's scoped one (which omits `.chart-svg` and `.tab-content.active`).
Established by injecting each of those classes into every loaded bundle and reading the computed style:
`animation: none` on all nine.

**The residual is ONE selector in ONE app.** OxyDex is the only app whose outer wrapper is `.main-wrap`
rather than `.main-content`, and `.main-wrap` is not in the guard's list — so the whole OxyDex surface
sits at `opacity: 0` under a frozen timeline. That is worse per-app than the brief's `.chart-card` story
(it is the entire app, not the cards) and far smaller fleet-wide.

### What this does to §3's route decision

**Neither route as written is warranted.** Route (a) is a spine edit to `ans-design.css` moving every
bundle; route (b) replicates a workaround into six `*-render.js`. Both were costed against "six apps
print blank", which is not the case. The fix is **one selector added to the guard that already exists**:

```diff
-    '#kpiStrip.show,#kpiStrip .kpi,.chart-card,.chart-svg,.tab-content.active,' +
+    '.main-wrap{animation:none!important;opacity:1!important;}' +
+    '#kpiStrip.show,#kpiStrip .kpi,.chart-card,.chart-svg,.tab-content.active,' +
```

in `entrance-guard.js`. It is still a shared module, so it re-bundles the **8 node apps** (not the
Integrator, which does not load it — its fixtures stay untouched). That is a real cost but a fifth of a
spine change, and it fixes the cause once rather than adding a seventh copy of the workaround.

### Why the fix is NOT in this PR

`CLAUDE.md` §👥.3 and this brief both say bundle work serializes. **Two bundle PRs were open** when this
ran (#776 ECGDex, #786 PpgDex), so landing an 8-bundle re-bundle would have collided with both. The
measurement, the tool and the one-line diff carry no bundle impact and land now; the re-bundle is left
to be scheduled against a clear window. §5's badge-mandate audit should ride the same window.

## §1-RESULT-II — FIXED 2026-08-03: it was TWO selectors across FOUR apps, and now a gate derives the set

§1-RESULT called the residual *"ONE selector in ONE app, OxyDex's `.main-wrap`"*. Measured again while
writing the guard's gate, it is **two selectors, four apps** — the second one in a node §1-RESULT never
looked at:

| unguarded selector | `ans-design.css` rule | who renders it | why it was missed |
|---|---|---|---|
| `.main-wrap` | `.main-wrap,.main-content{…animation:fadeIn}` | OxyDex (22 uses), **HRVDex, PulseDex** | the guard pinned only its comma-sibling `.main-content` |
| **`.kpi`** | `.kpi{animation:cardEntrance .35s ease both}` | **CPAPDex** — which has **no `#kpiStrip` at all**, it renders every KPI into its own `.kpi-grid` | the guard pinned the *narrower* `#kpiStrip .kpi` |

Confirmed by computed style under a frozen timeline: outside `#kpiStrip` the element reads
`opacity=0 / animationName=cardEntrance`; inside, `opacity=1 / none`.

**Both are now guarded, and the guard is gated.** The new group derives its expectation FROM
`ans-design.css` — every keyframe whose `from` sets `opacity: 0`, every rule consuming one, each
required to be pinned — so a newly-animated selector fails until it is guarded. That is what turns this
from a fix into a closed class: `entrance-guard.js` had previously appeared in `tests/dex-tests.js`
exactly once, as a **comment in an exclusion list**, so nothing could have reported either gap.

**Verified by mutation, and the first two versions of the gate were wrong** — recorded because it is the
whole argument for re-applying the defect: a substring test reported the `.kpi` revert as *covered*
(`#kpiStrip .kpi` **contains** `.kpi`), i.e. the gate could not see the very bug it exists for; then the
literal extractor swallowed the file's `/* header */` and `var ID = 'dx-entrance-guard'`. One false
green, then two false reds. Final: **5 mutants, 5 killed** (revert `.kpi`, drop `.main-wrap`, weaken
`!important`, unwire the guard from a shell, empty the guard CSS → 26 reds).

Independent of §1-RESULT's CDP tool, the same conclusion fell out of a `--virtual-time-budget` sweep:
unmitigated a 400×200 block paints **0** px at vtb=1 and 80000 at vtb=5000; with the guard, 80000 at
both. §1-RESULT's warning about `getAnimations()` is right and worth keeping — a post-load rewind
measures nothing, because the entrance has already finished and finished animations are no longer
returned.

## Done when

- [x] **REPRODUCED 2026-08-03** under a frozen timeline, computed `opacity`, not a source scan —
      `tools/frozen-timeline-check.mjs`. One surface blanks: OxyDex `.main-wrap`.
- [ ] ~~Route (a) or (b)~~ — **both are mis-costed**; the measured fix is one selector in the EXISTING
      `entrance-guard.js` (8 node bundles, not the fleet spine). Owner to confirm and schedule.
- [ ] Shown gone after the fix — re-run the same tool; OxyDex must report 0 hidden.
- [ ] A gate asserts the computed end-state, verified by re-applying the defect (it must red).
- [ ] If (a): the Integrator's scoped override is **deleted**, not left shadowing the fix.
- [ ] All bundles rebuilt, every `provenance/<App>.json` re-stamped, GATE A/B green, `--check` clean.

## Cross-references
- Parent: `AUDIT-FOLLOWUPS-BRIEF.md` §4.1 · original source `INTEGRATOR-EXPORT-FIX-BRIEF.md` secondary list.
- Code: `ans-design.css` :217 · :221 · :854 · :911 · :1045 · :1195 · :240 · :2389 ·
  `integrator-render.js` :29-37 (the working patch and its rationale).
- `CLAUDE.md` §👥.3 (spine changes serialize) · §🔏 (re-bundle + provenance) · §🎫 (the §5 badge mandate).
