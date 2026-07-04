<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Dex Suite — Audit & Direction (June 2026)

A health + friction pass across the whole suite. Read this before re-investigating
anything that looks "off" — most of it is already explained or resolved here.

---

## 0. Runtime health — GREEN

All six bundles load with **zero console errors** on the demo / empty path:
OxyDex, HRVDex, PulseDex, ECGDex, GlucoDex, Integrator. No `ReferenceError`,
no missing-global from the module split. The suite is runtime-clean.

> Not exhaustively tested: every real-file ingest branch. If you touch a `*-dsp.js`
> parser, load the matching sample in `uploads/` and diff key metrics (per the old
> refactor brief's verification list, now in `docs-archive/`).

---

## 1. Resolved this pass

### 1a. Fonts — the recurring "missing woff2" tax, killed at the root
**Problem:** CLAUDE.md promised "100% local, no CDN," but the font layer leaked to
Google three different, inconsistent ways, and every other app pointed `@font-face`
at `Inter-*.woff2` / `IBMPlexMono-*.woff2` files **that were never committed** → the
inliner warned "missing woff2" on every bundle, then fell back to system fonts anyway.
That warning got re-explained ("pre-existing, system fallback per CLAUDE.md") every
visit — pure token tax.

**Fix (system stacks only, everywhere):**
- Removed the CDN `@import` from `ans-design.css`.
- Removed the Google Fonts `<link>`s from `HRVDex.src.html`.
- Removed the dead missing-woff2 `@font-face` blocks from `ans-design.css`,
  `OxyDex.src.html`, `HRVDex.src.html`, `PulseDex.src.html`, `OxyDex Reference.html`.
- Removed PulseDex's dead `preconnect` links (its IBM Plex Mono is bundled **locally**
  as inliner assets, not fetched — that block was **kept**, it's offline and renders).
- The `'Inter'` / `'IBM Plex Mono'` names in font stacks now fall through to
  `system-ui` / `ui-monospace`. **Zero visual change** — that's exactly what was
  already rendering once the missing woff2 fell back.

**This class of warning is now closed. Do not reintroduce `@font-face` or a CDN.**
(Also recorded under "Known non-issues" in CLAUDE.md.)

> ⚠️ The bundled `*.html` snapshots still contain the old font refs. They're harmless
> (no re-warn unless rebuilt). **Next time you re-bundle each app from its `.src.html`,
> the bundle comes out clean** — no action needed until then.

### 1b. Naming — frozen on "Ganglior"
The "rename to Fascia pending" note is removed from CLAUDE.md. Ganglior is the name.
The Integrator still accepts a `fascia` alias on **input** (`BUS_ALIASES`) for
forward-compat — that's deliberate, leave it. No emitter changes needed.

### 1c. Stale docs
- `REFACTOR-BRIEF-modularize-Dexes.md` described the pre-refactor monolith world
  (`OxyDex v2.html ~13k lines`, `(standalone)` filenames). The refactor is **done**.
  Moved to `docs-archive/` so it stops contradicting the live tree.
- The `@font-face` block comments said "re-run **sync-design.py**" — that script
  isn't in the project. **UPDATE 2026-07-03 (OWN-THE-BUILD Part A):** the hand-mirror is **RETIRED** — every app now
  `<link>`s the ONE `ans-design.css`, which the owned bundler (`tools/build.mjs`) inlines, so mirror drift is
  unrepresentable. OxyDex/HRVDex were the last two on the inline `ANS-DESIGN-START` mirror (single-sourced 2026-07-03,
  reconciling their drifted tokens to the canonical file). No mirror or sha to bump any more.

---

## 2. Open items (not changed — your call)

| # | Item | Why it's friction | Options |
|---|---|---|---|
| 2a | **`sync-design.py` doesn't exist** | The design CSS lives inline in 6 apps + `ans-design.css`, kept in sync by hand. One forgotten copy = silent drift. | (a) recreate the script; (b) make each app `<link>` `ans-design.css` and drop the inline copies (loses single-file portability); (c) accept hand-sync, rely on the sha tag. |
| 2b | **Clock contract + `parseTimestamp` duplicated 5×** | Mandated today. A fix to date parsing must land in 5 files identically or signals desync. | Keep duplicating (current rule) vs. extract one versioned `dex-clock.js` every app bundles in. See §3. |
| 2c | **Empty-state void** | Integrator (and others) open as a large black emptiness pre-load. First impression reads as "broken / blank." | Add a load-prompt / drop-zone hero as the default empty state. |

---

## 3. Direction: standalone-per-signal vs Integrator-as-shell

**You flagged this one to dig into.** Here's the honest tradeoff.

### Today: 6 standalone single-signal apps + an Integrator that ingests their exports
**Strengths (this is genuinely good, don't throw it away):**
- Each app is one self-contained file. Trivial to ship, audit, hand to someone
  ("here's just the oximetry one"), and reason about for privacy.
- Low coupling — a bug in ECGDex can't take down GlucoDex.
- Matches the product story: *single-signal analyzers that emit onto a shared bus.*

**Costs:**
- Heavy duplication: clock/parser, design block, profile panel, chart helpers all
  live N times. Shared changes = N edits + N verifications (the §2 friction).
- Cross-signal workflow is a chore: export JSON from each app, re-upload into the
  Integrator. The fusion payoff is gated behind manual file-shuffling.

### Alternative: Integrator becomes the shell, signals become loadable nodes
**Strengths:** shared code lives once; consistent UI; fusion is first-class (load all
raw files in one place, no export/re-import dance).
**Costs:** one big artifact; loses the "one signal, one file" simplicity and its clean
privacy/portability story; larger blast radius; it's a real refactor; and it
contradicts current CLAUDE.md rules.

### Recommendation — middle path (keep the unit, kill the tax)
1. **Keep standalone-per-signal as the shipping unit.** Independence is a feature, not
   debt. Don't collapse into a monolith.
2. **Extract only the drift-prone shared primitives** into versioned modules each app
   bundles in — start with `dex-clock.js` (clock contract + `parseTimestamp`), then the
   design tokens, then the profile panel. This kills the worst duplication without
   touching app independence. *(Note: this reverses the current "duplicate verbatim /
   no shared util" rule — it's a deliberate policy change to ratify, not a drive-by.)*
3. **Make the Integrator the multi-signal cockpit** and remove the export/re-upload
   friction: a one-click "send to Integrator" handoff, or let the Integrator read a
   folder of node exports at once.

This preserves the offline single-file virtue while retiring the maintenance tax — but
because it changes mandated conventions, it should be an explicit decision, then a
focused build, not something done incidentally.

---

## 4. Re-bundle checklist (when you next build)
Edited this pass: `ans-design.css`, `OxyDex.src.html`, `HRVDex.src.html`,
`PulseDex.src.html`, `OxyDex Reference.html`. Re-bundle OxyDex / HRVDex / PulseDex
from their `.src.html` to fold the font cleanup into the standalones (optional — the
current bundles work; this just makes the next build warning-free).
