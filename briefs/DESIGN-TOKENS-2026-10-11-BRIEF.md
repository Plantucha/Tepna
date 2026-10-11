<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-10-11 · **Owner ask:** 2026-10-11 ("graphically update all html pages in same manner like you did nights, more readable, not crowded, unify color pallets, make it pretty, futuristic design, old limits still apply") · **Pilot:** the monitor's Nights view, PR #3445 · **Sequencing:** Kestrel's ruling 2026-10-11 (spine work; nothing else touches shared CSS before this lands)

# One look for every page: the design tokens and the rules that come with them

## 1 · What the owner asked, and what already exists

The owner approved the Nights view after two rounds on a mockup, then asked for every HTML page to be readable and uncrowded in the same way, under one palette, while keeping every existing limit.

**A design system already exists.** `ans-design.css`, *Tepna Design System v1.0*:
- its §1 defines the surface, text, brand / status, radius, type-scale and spacing tokens;
- it is inlined into all nine app bundles and the monitor uses its §1 values.

This brief **extends that system**. It does not start a second one.

**Census of the 102 authored pages** (bundles counted by their `.src.html`, `docs/` copies and `docs-archive/` excluded; measured on rig 2026-10-11):

| palette source | pages | which |
|---|---|---|
| `ans-design.css` | 29 | the nine apps, the orchestrators, the test suite, the PAT pages |
| their own `:root` palette | 34 | `index.html`, Architecture, Science, Glossary, the five `* Reference.html` pages, OverDex, Data Unifier, most `*-analysis.html` tools, `verify-provenance.html`, `no-network.html` |
| no palette at all | 39 | `papers/*.html` (on `paper.css`), self-test and round-trip harnesses, generated references |

**"Unify the palette" therefore means two things:**
1. Add the status vocabulary the Nights view introduced to §1.
2. Move the 34 own-palette pages onto §1.

The papers stay on `paper.css`: they are documents meant to print, not screens.

Rule 0 (rig, bge-m3, 2026-10-11): `design system tokens palette shared css across apps` → `audits/AUDIT.md`, `INTEGRATOR-BUILD-BRIEF`, `ECGDex-BUILD-BRIEF`, `REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04`, `PROFILE-UNIFY-BRIEF`. None of them defines a status vocabulary or a readability rule.

## 2 · The tokens to add to `ans-design.css` §1

These are lifted from the Nights view's one block (`#view-nights { --n-* }`, PR #3445). Renamed `--st-*` because they are status, not Nights.

```css
/* ── Status: HUE AND GLYPH, never hue alone ── */
--st-ok:    var(--green);    /* ✓  complete / passed              */
--st-part:  var(--amber);    /* ◐  partial                        */
--st-low:   var(--red);      /* ✕  short / failed                 */
--st-rec:   var(--teal);     /* ●  present, not measured to a %   */
--st-unk:   var(--text3);    /* ?  not measured yet / unknown     */
--st-hatch: rgba(255,255,255,.10);   /* –  absent: hatched, never an empty bar that reads as 0 */
--st-track: rgba(255,255,255,.07);   /* a bar's empty track */
--st-hover: rgba(61,224,208,.06);
--bar-h:    8px;             /* inline coverage bars */
--cell-r:   8px;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

- **Light theme:** `--st-hatch: rgba(0,0,0,.10)`, `--st-track: rgba(0,0,0,.08)`, `--st-hover: rgba(14,158,145,.08)`, in §1's existing light block.
- **The glyphs are part of the contract,** fixed as `✓ ◐ ✕ ● ? –`. No two states share one, which is what lets a colour-blind reader, or a grey printout, read status.
- **No new hues.** Every status token points at an existing §1 colour. "Futuristic" is reached by treatment, not by more colours (§3).

## 3 · The rules, each one from the Nights review

1. **Status is hue AND glyph.**
   - One hue means one thing on a page. The Nights table used amber for both "ResMed" and "< 60 %", so a short night could not stand out.
   - Device identity moves to column headers; colour is kept for status.
   - Sources: Healey & Enns 2012 (doi:10.1109/TVCG.2011.127), Wong 2011 (doi:10.1038/nmeth.1618).
2. **Overview first, details on demand** (Shneiderman 1996, doi:10.1109/VL.1996.545307).
   - A page with many records opens on a strip or summary.
   - A row's detail opens under it (a drawer); it is not printed in every cell.
3. **Length carries the number, colour carries the class** (Cleveland & McGill 1984, doi:10.1080/01621459.1984.10478080).
   - Bars are `--bar-h` (8 px): thick enough to carry a status colour.
   - Rules between rows stay hairline; separation comes from spacing and a faint zebra.
   - Heavier rules were tested and do not help (Enders 2008, A List Apart #258).
4. **Absence is drawn, never left blank** (§∅; Song & Szafir 2019, doi:10.1109/TVCG.2018.2864914).
   - Absent: hatched `–`.
   - Present but not measured: `●` or `?`, never a coverage it does not have.
5. **No more columns than a screen holds.**
   - A column empty on every row is hidden behind a toggle.
   - Figure-only columns move into the drawer.
6. **History folds.** The most recent window stays open (31 nights on the Nights view); older periods collapse to one summary line each.
7. **"Futuristic" means:**
   - the dark-first `--bg` ground;
   - one restrained teal accent with `--glow-teal` on the active control only;
   - tabular monospace figures (`--font-mono`);
   - pill tabs;
   - squares and bars aligned on one grid.

   It does not mean gradients on data, animated numbers, or glow on every card. Motion respects `prefers-reduced-motion`.

## 4 · Limits that do not move

- **Local only:**
  - no network, no CDN, no `@font-face`;
  - system font stacks (CLAUDE.md, `no-network.html`);
  - the Google-Fonts allowance of an Artifact mockup does **not** carry over.
- **Edit `*.js` / `*.src.html`, never a bundle.** Re-bundle with `tools/build.mjs`, then `npm run check` in full.
- **This is a render change, so export-inertness must be computed.** Each re-bundle must show **`computeHash` unchanged** (§🔒). A moved `computeHash` means the edit reached the compute closure and is not a restyle.
- **`ans-design.css` is spine:**
  - the §2 token addition moves the `manifestHash` of every bundle that inlines it, so it lands **alone and first**;
  - every later node PR rebases on it (CLAUDE.md §3).
- **Evidence badges stay exactly as they are.** The disc shapes and `MetricRegistry.BADGE_CSS` are their own contract (§🎫); this brief never restyles a badge.
- **Light theme stays a first-class theme** on every page that has one.

## 5 · Order

1. **Pilot:** the Nights view (#3445). The owner approves the look on the live page.
2. **Tokens:** §2 lands in `ans-design.css` §1 alone. All carrying bundles re-bundle, `computeHash` unchanged, `npm run check` green.
3. **The Nights view switches** from its local `--n-*` block to the shared `--st-*` tokens. The pilot then proves the shared tokens reproduce it.
4. **Node by node, in Magpie's lane, one PR each,** behind the OxyDex absence batch and paced by the budget:
   - the nine apps, each against §3;
   - then the 34 own-palette pages, the front page and the references first.

   Each PR shows its page before and after, at desktop and phone width, and leaves `computeHash` unchanged.
5. **Census as a ratchet.** The census in §1 becomes a check that counts own-palette pages. It may only shrink.

## 6 · Done when

- §2 is in `ans-design.css` §1, and every carrying bundle's `computeHash` is unchanged.
- The own-palette count is **0**, apart from named, reasoned exceptions (`no-network.html` must stay self-contained to prove what it proves).
- No page in the census carries a status that is hue alone. Checked by a scan for status classes rendered without a glyph, and that scan is a gate, not a claim.
- The owner has approved the pilot and at least one restyled app on the live box.
