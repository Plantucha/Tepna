<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-15 · **Audience:** an AI agent (or human) doing a MOBILE / small-screen behavior audit of the Tepna Dex suite · **Sibling-of:** `AUDIT-PROMPT.md` (the CORRECTNESS charter — read it first), `audits/EFFICIENCY-AUDIT-PROMPT.md`, `audits/PRIVACY-SECURITY-AUDIT-PROMPT.md`

# Mobile-audit charter — Tepna Dex suite

> **Paste the "MISSION" block below to start a mobile auditor.** The rest of this file is the reference it
> reads, including a **ready-to-run harness** so you do not have to rediscover how to drive these bundles at
> phone widths. Tuned to *this* codebase: the apps are single-file, 100%-offline `Foo.html` bundles with a
> strict CSP, and their PRIMARY input is drag-drop — so "just open it on a phone" under-tests them.
>
> **Correctness ALWAYS wins (see `AUDIT-PROMPT.md`).** A layout fix that changes a surfaced *number* is a
> regression, not a win. Mobile findings are **presentation-layer**: CSS + markup only. If a proposed fix
> would touch a `*-dsp.js` / `*-cross.js` compute path, you are no longer doing a mobile audit — stop.

---

## MISSION (paste this)

You are running a **mobile-behavior audit** of the **Tepna Dex suite** — browser-based, 100%-offline
physiological-signal analyzers meant to be usable on a phone (they ship a correct `width=device-width`
viewport and a lot of `@media` CSS, so mobile is an intended surface, not an afterthought). Your job is to
find **real small-screen defects** a phone user would hit — content that overflows, taps that miss, text
that can't be read — and propose **one gated, CSS/markup-only change at a time**, never a speculative sweep.

**MEASURE, DON'T EYEBALL.** Every finding carries a **number + a reproduction**: a measured pixel overflow,
a `getBoundingClientRect()` tap-target size, a computed `font-size`, a viewport width at which it breaks, or
a before/after screenshot. Drive a **real headless phone viewport** (the harness below), don't reason from
the CSS alone — a `@media` rule that looks right can still be beaten by an inline width or a flex child.

**Method:** state a **mobile invariant** and hunt **counterexamples** at phone widths (360 / 375 / 414 CSS
px) in BOTH states the app has — the **empty landing shell** AND a **populated dashboard** (populate it with
the app's own **"Generate synthetic"** button — no file, no network needed; see the harness). Always take a
**desktop control** reading (1280) too, so you can tell a *mobile regression* ("small only on the phone")
from a *global choice* ("this control is 32 px tall everywhere") — the fix and the severity differ.

**Before you start:** read `ORIENTATION.md` and `CLAUDE.md` (the constitution — CSS edits still go in
`*.src.html` / the shared `*.css`, NEVER the bundled `.html`; re-bundle after). Establish the two green
gates first (`Dex-Test-Suite.html?full`, `verify-provenance.html`) so you don't blame a pre-existing red on
your CSS. Read the **"Out of scope"** list below so you don't file conventional-small (chart tick labels)
or known/intentional behavior.

Deliver findings in the **"Reporting"** format. Findings are presentation-only and almost always
**EXPORT-INERT** (render/CSS edits move `manifestHash` but NOT `computeHash` — no fixture re-record; prove
it, don't assert it — `CLAUDE.md` §🔏).

---

## The mobile bug classes worth hunting (highest yield first)

1. **Horizontal overflow / body-scroll — the #1 mobile bug.** The invariant: at every phone width the page
   body must NOT scroll sideways — `documentElement.scrollWidth ≤ innerWidth` (a few px slack). A wide chart,
   a dense metric table, a long unbroken token (a hash, a filename, a `ganglior.node-export` string), or a
   fixed-`px`/`min-width` card that beats its column all break it. **The sanctioned escape** is an inner
   `overflow-x:auto` scroll container (the wide thing scrolls inside its own box, the page does not) — verify
   wide content actually lives in one, rather than pushing the body. Test **populated**, not just the shell.

2. **Tap targets < 44×44 CSS px** (WCAG 2.5.5 / Apple HIG 44pt / Android 48dp). Enumerate genuinely
   interactive, *visible* controls (`button, a[href], input, select, [role=button], [onclick], label[for]`)
   and flag any whose rendered box is under 44 in either dimension. Height is the usual offender (a 32 px
   export chip, a 22 px mode pill, an 18 px text-link "button", a 20 px `<select>`). These are often SHARED
   component classes — fixing one class fixes the fleet. Note whether it's also small on the desktop control:
   fixed-px-small is fine on a mouse but still a real touch defect, so it's in scope — but say so.

3. **Sub-12px readable text — legibility.** Flag computed `font-size < 12px` on **readable content**: metric
   values, finding/KPI prose, badge tier labels, nav/button labels, form text. On a 3× phone at reading
   distance, 10–11 px prose is a strain (iOS treats ~11 px as the floor; ~16 px is the mobile body norm).
   **Scope discipline:** chart-axis micro-labels and dense reference-table cells are conventionally small —
   exclude them (see Out of scope); the yield is *prose and controls* rendered sub-12, not every SVG tick.

4. **Viewport meta correctness.** Each bundle must carry `<meta name="viewport" content="width=device-width,
   initial-scale=1">` with **no** `user-scalable=no` / `maximum-scale=1` (those lock pinch-zoom — a WCAG
   1.4.4 fail). (As of 2026-07-15 all 10 owned bundles pass this — re-check on new nodes.)

5. **Sticky / fixed occlusion.** A sticky header, a bottom toolbar, an export bar, or a theme toggle that is
   fine on desktop can eat a large fraction of a 667 px-tall phone or cover content/inputs. Check fixed/sticky
   elements aren't taller than ~15% of viewport height and don't overlap the primary content or the upload
   zone at 375×667.

6. **Breakpoint / responsive-collapse regressions.** These apps switch a desktop sidebar to a hamburger +
   off-canvas nav below a breakpoint. Verify the collapse actually happens at 360–414, the menu opens/closes,
   nothing is double-rendered (grep the `.src.html` for duplicate `<nav class="mobile-nav">`-style blocks —
   runtime may dedupe, but the source smell is worth a note), and no desktop-only element is left stranded.

7. **Touch-only affordances.** Anything that needs `:hover` to be usable (a tooltip that is the only place a
   number's units/uncertainty appears, a hover-reveal control) is invisible on touch. Hunt hover-gated
   information that has no tap/inline equivalent.

8. **Regression-on-re-bundle.** Mobile CSS is unguarded by any gate today, so a re-bundle can silently move a
   breakpoint. If you add coverage, a tiny Playwright smoke (overflow ≤ slack at 375, per bundle) wired into
   `tests/browser-gates.mjs` is the highest-leverage net — it promotes "no horizontal scroll" from a manual
   pass to an enforced property.

---

## How to verify — the ready-to-run harness (don't rediscover this)

The bundles have a strict CSP and are drag-drop-first, so the reliable way to drive them is Playwright over a
local HTTP server, populating via each app's own client-side **"Generate synthetic"** (analyzers) or
**"Load bundled samples"** (Integrator) button — no file, no network.

```sh
# 1. serve the repo (the apps are self-contained; http lets any bundled sample fetch resolve too)
python3 -m http.server 8099 &

# 2. Playwright + Chromium are pre-installed GLOBALLY in this env (not in the repo node_modules).
#    ESM can't bare-import it; point at the absolute path and default-import (it's CJS):
#      import pw from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pw;
#    (In CI, tests/browser-gates.mjs bare-imports 'playwright' after `npm ci` — that path is only for
#     an ad-hoc audit run in this environment.)
```

**Per bundle × viewport** (viewports: 360×740, 375×667, 414×896 mobile + 1280×800 control; `newContext({
viewport, isMobile:true, hasTouch:true, deviceScaleFactor:3 })`): `goto(load)` → wait → click the visible
**"Generate synthetic"** control (regex `/(generate synthetic|load bundled|use sample)/i`) → wait ~4 s for
the DSP to populate → then `page.evaluate` these invariants:

- **overflow** — `documentElement.scrollWidth − innerWidth` (flag `> 3`); list the elements whose
  `getBoundingClientRect().right > innerWidth` and `width ≤ innerWidth·2` (the ones that introduce it).
- **tap targets** — the interactive selector above, visible, box `< 44` in either axis → count + samples
  (`{tag.class, w, h, text}`).
- **tiny fonts** — leaf text nodes with non-empty text, visible, computed `font-size < 12` → count + samples.
- **viewport meta / mobile-nav** — `<meta name=viewport>` content; `document.querySelectorAll('.mobile-nav').length`.
- **console/pageerror** — attach `page.on('console'|'pageerror')` before `goto` (a mobile-only JS error is a
  real bug, higher severity than layout).

A worked copy of this harness (the exact `MEASURE` closure + populate helper) is described in
`audits/MOBILE-AUDIT-FINDINGS-2026-07-15.md` §Method — copy it rather than rewriting. Targets that ingest a
real file and have no synthetic generator (CPAPDex, Data Unifier, OverDex) only audit as an empty shell here;
to audit their populated dashboards, drop a committed `uploads/` sample via `setInputFiles`.

---

## Out of scope — do NOT file these (known/intentional / conventional; filing them wastes time)

- **Chart-axis / SVG micro-labels and dense reference-table cells under 12 px** — small is the convention for
  tick labels and abbreviation tables; only prose/metric/control text sub-12 is a finding.
- **A control that is the same small size on the 1280 desktop control** is still in scope as a *touch* defect
  (list it), but do NOT frame it as a "mobile regression" — it's a global sizing choice; say which it is.
- **The `Integrator.src.html` triple `<nav class="mobile-nav">`** — noted in `DEEP-AUDIT-2026-07-11` §3;
  runtime dedupes to a single nav. It's a source-hygiene smell, already known — cite it, don't re-discover it.
- **Viewport-meta "missing"** — all 10 owned bundles carry a correct one (verified 2026-07-15).
- **Horizontal scroll INSIDE an `overflow-x:auto` container** — that is the *sanctioned* pattern for wide
  charts/tables (CLAUDE.md artifact rule); only BODY-level horizontal scroll is the bug.
- Anything on the **`CLAUDE.md` "Known non-issues"** list, or already tracked **open** in `DOCS-INDEX.md`.

---

## Reporting (one entry per finding)

For each finding, give:
- **Severity** — top = *content unreachable/unreadable on a phone* (body overflow hiding data, a control you
  can't hit, prose you can't read); then *touch-ergonomics* (sub-44 targets that are hittable but fiddly);
  then *source hygiene / defense-in-depth*. Say which.
- **Symptom** — one line, with the **width it bites at** and whether **empty or populated**.
- **Reproduction** — the measured number (overflow px / box size / font px) + the surface + viewport. (No
  measurement → mark **HYPOTHESIS**.)
- **Root cause** — the CSS rule / shared class / element, and why it wins at that width.
- **Fix sketch + gate cost** — the CSS/markup change (prefer fixing a SHARED class → fleet-wide), which
  `.src.html` / shared `.css` it edits, which bundles re-bundle, and the EXPORT-INERT proof (`computeHash`
  unchanged — render-only). One gated change at a time.

Group findings by shared-component vs per-node. End with a **prioritized punch-list** (unreachable/unreadable
first, ergonomics next, hygiene last), and note whether a `browser-gates.mjs` mobile smoke was added.
