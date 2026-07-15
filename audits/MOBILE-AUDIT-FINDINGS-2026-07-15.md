<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** FINDINGS (report) — 2026-07-15 · **Created:** 2026-07-15 · **Charter:** [`audits/MOBILE-AUDIT-PROMPT.md`](MOBILE-AUDIT-PROMPT.md)

# Mobile-audit findings — Tepna Dex suite (2026-07-15)

First run of the mobile charter. **Headline: the layout is structurally sound on a phone — zero horizontal
body-scroll anywhere, empty or populated, and no mobile-only JS errors.** The real defects are
**touch-ergonomics** (sub-44 px tap targets) and **legibility** (sub-12 px readable text), both concentrated
in a handful of **shared component classes**, so the fixes are CSS-only and fleet-wide. All findings are
presentation-layer and **EXPORT-INERT** (render/CSS — `computeHash` unmoved; no fixture re-record).

## Method

Playwright + Chromium over `python3 -m http.server`, each bundle driven at **360×740 / 375×667 / 414×896**
(mobile, `isMobile:true, hasTouch:true, dpr:3`) plus a **1280×800 desktop control**. Populated via each
app's own client-side **"Generate synthetic"** button (Integrator: "Load bundled samples") — no file, no
network. Per surface we measured body overflow, every visible interactive box vs 44×44, computed font-size
of visible leaf text, viewport-meta content, `.mobile-nav` runtime count, and console/pageerror. Harness:
`scratchpad/mobile-audit.mjs` (the charter's §"How to verify" documents the exact closure to reuse).
Surfaces: the 8 apps + 2 orchestrators + `index.html` + one Reference guide (12 total).

## ✅ Clean bills (do NOT re-chase — recorded so the next auditor skips them)

- **No horizontal body-scroll.** `scrollWidth − innerWidth = 0 px` on **all 12 surfaces at 360/375/414**,
  in BOTH the empty shell AND the synthetic-populated dashboard. Wide charts/tables are correctly held in
  inner `overflow-x:auto` containers — the page body never scrolls sideways. The #1 mobile bug is absent.
- **Viewport meta correct on all 10 owned bundles** — `width=device-width, initial-scale=1.0`, no
  `user-scalable=no`/`maximum-scale` (pinch-zoom preserved; no WCAG 1.4.4 fail).
- **No mobile-only console/pageerror** on any surface at 375 px.
- **Integrator `.mobile-nav` dedupes at runtime** — `DEEP-AUDIT-2026-07-11 §3` flagged 3 duplicate
  `<nav class="mobile-nav">` blocks in `Integrator.src.html`; the runtime DOM carries exactly **1**. Live
  behavior is fine (see F3 for the residual source smell only).

## Findings

### F1 — Tap targets below 44×44 px (touch ergonomics) · **shared classes · fleet-wide**
**Severity:** touch-ergonomics (hittable but fiddly; the top actionable finding).
**Symptom:** every analyzer renders 30–44 interactive controls under the 44 px minimum (WCAG 2.5.5 / Apple
HIG 44 pt / Android 48 dp) at 375 px populated — the count barely differs from the desktop control (e.g.
PulseDex 41 mobile / 43 desktop), so these are **fixed-small components**, not a mobile-only regression — but
they are still a real touch defect on a phone. The offenders concentrate in shared classes:

| class | rendered box | where | note |
|---|---|---|---|
| `button.eb-btn` (⬇ JSON/CSV/PDF/RR…) | 104×**32** | export bar — HRVDex/ECGDex/GlucoDex/PpgDex | most common; height 32 |
| `button.theme-toggle` (☀️ Light) | 74×**25** | every analyzer header | height 25 |
| `button.synth-link` (Generate synthetic) | 124×**18** | OxyDex, Integrator | height 18 — worst |
| `button.mode-btn` (Core/Advanced/Research) | 48×**22** | CPAPDex, ECGDex, GlucoDex | height 22 |
| `select` (scenario / duration pickers) | 91×**20** | OxyDex, Integrator | native select, height 20 |
| `a.sb-item` (sidebar nav rows) | 255×**38** | PulseDex off-canvas nav | height 38 |
| `button.abbr-tab` (A/B/C… index) | **17×18** | Reference guides | 26 alphabet tabs, tiny both axes |
| top-nav `a` (Devices/Science/About…) | 40–83 × **43** | `index.html` | borderline (43, just under) |

**Repro:** `getBoundingClientRect()` on the selector `button, a[href], input, select, [role=button],
[onclick], label[for]` at 375×667, filtered to visible boxes `< 44` in either axis. Raw per-app counts
(375, populated): HRVDex 44 · PulseDex 41 · ECGDex 35 · GlucoDex 35 · PpgDex 31 · Integrator 23 · OxyDex 13
· `index` 20 · Reference 142.
**Root cause:** the shared header/export/nav components set explicit small `height`/`padding` with no
touch-size floor.
**Fix sketch:** raise the shared classes to a **44 px min hit area** — `min-height:44px` (+ padding, or an
invisible `::before` hit-expander to keep the visual chip compact) on `.eb-btn`, `.theme-toggle`,
`.mode-btn`, `.synth-link`, `.sb-item`, and the native `select` — ideally scoped to the existing mobile
breakpoint / `@media (pointer:coarse)` so desktop density is untouched. CSS-only in the shared `*.src.html`
blocks; re-bundle the affected analyzers; **EXPORT-INERT** (prove `computeHash` unchanged). Fixing the ~6
shared classes clears most of the fleet in one pass.

### F2 — Readable text below 12 px (legibility) · **global density choice**
**Severity:** legibility (readable but strained on a phone).
**Symptom:** pervasive sub-12 px text, heavier when populated — ECGDex 1290 · GlucoDex 789 · PulseDex 738 ·
PpgDex 583 · HRVDex 308 nodes at 375 px. Mobile count ≈ desktop control (738 vs 741) → a **global sizing
choice**, not a mobile regression — but 10–11 px prose on a 3× phone is below the ~16 px mobile body norm
and iOS's ~11 px floor. The **actionable** subset (exclude chart ticks / dense reference tables — those are
conventionally small, see charter Out-of-scope) is readable prose and labels rendered sub-12:

- **10 px:** `index.html` hero stat "Last night · readiness", app cards ("OxyDex").
- **11 px:** Integrator finding prose — "p(spurious)=0.143 · 6.99", "4/12 desats paired", "1 supine · 3
  non-supine" (these ARE the surfaced findings, not chrome); version strings; section labels.
- **11.5 px:** export button labels (⬇ JSON/CSV/PDF); evidence-badge tier labels (Measured/Validated/Emerging).

**Repro:** computed `font-size < 12` on visible leaf text nodes at 375 px (samples captured per surface).
**Root cause:** base type scale + component labels set in fixed `px` with no mobile bump.
**Fix sketch:** lift sub-12 **prose / metric / label** text to ≥12 px (≥13–14 for finding prose) under the
mobile breakpoint. ⚠️ **Caveat:** the evidence-badge tier labels come from the SINGLE-SOURCED badge CSS
(`metric-registry.js` `BADGE_CSS` ≡ `dex-badges.css`, gated by `cohesion-badges`) — if you resize those, edit
BOTH files together or the gate reds; safest to bump the *surrounding* label, not the disc. CSS-only,
re-bundle, EXPORT-INERT.

### F3 — Integrator source carries 3 duplicate `<nav class="mobile-nav">` (source hygiene) · **low**
**Severity:** source hygiene (no live impact).
**Symptom:** `Integrator.src.html` declares the mobile nav three times; the runtime dedupes to one (verified
— `.mobile-nav` count = 1), so users are unaffected. Already noted in `DEEP-AUDIT-2026-07-11 §3`.
**Fix sketch:** delete the two redundant blocks in `Integrator.src.html`, re-bundle Integrator + OverDex (the
orchestrators inline it), EXPORT-INERT. Cosmetic; batch with the next Integrator touch.

## Coverage gaps (honest limits of this run — not clean bills)

- **OxyDex populated dashboard not fully exercised.** Its "Generate synthetic" click didn't expand the
  dashboard in-harness (counts stayed at empty-shell levels 13 taps / 27 fonts) — likely a second-step or a
  different affordance. Re-audit OxyDex populated by hand or by scripting its actual synth flow.
- **CPAPDex / Data Unifier / OverDex audited as EMPTY shells only** — they ingest a real file (EDF / node
  exports) and have no synthetic generator, so their populated dashboards were not measured. Drop a committed
  `uploads/` sample via `setInputFiles` to cover them.

## Prioritized punch-list

1. **F1 — bump the ~6 shared control classes to a 44 px touch floor** (mobile breakpoint) — biggest UX win,
   one CSS pass, fleet-wide, EXPORT-INERT.
2. **F2 — lift sub-12 px finding/metric/label prose to ≥12 px** on mobile (mind the gated badge CSS caveat).
3. **Add a `browser-gates.mjs` mobile smoke** — assert body `scrollWidth ≤ innerWidth + slack` at 375 px per
   bundle. Cheap net that promotes today's clean "no horizontal scroll" from a one-time manual pass to an
   enforced property, so a re-bundle can't silently regress it.
4. **F3 — dedupe Integrator's `mobile-nav`** (source only) — batch with any Integrator re-bundle.
5. Close the coverage gaps (OxyDex populated; CPAPDex/DataUnifier/OverDex via `setInputFiles`).

Each fix should land as its own gated change with a source-mirror or Playwright assertion, per
`AUDIT-PROMPT.md` reporting discipline. Nothing here touches a compute path.
