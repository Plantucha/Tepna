---
bump: patch
type: added
brief: none
---

**The ungated `*-app.js` / `*-render.js` / `integrator-*` surface, swept for producer-dependent
safety: clean negative, and the negative is the deliverable.**

The class: a consumer guard whose correctness rests on an **unstated invariant of its producer**. The
carrier is `x || fallback`, which silently replaces a legitimate **0**. This surface has no
equivalence gate, so nothing catches it mechanically.

**26 files, 100 candidate sites, no live defect.** 41 are `|| 0` — harmless by construction, since a
falsy 0 defaults to 0. The rest resolved individually, and the resolutions are recorded rather than
summarised, because "we found nothing" is worth less than "here is why each is sound".

**Three sites are safe ONLY because of a producer invariant**, and are named so a change there is
understood to carry the consequence: the Integrator's `dawn.medianDelta` chain (GlucoDex's *export*
drops sub-20 values though the in-memory object keeps them — the safety is a property of the export
shape); `motiondex-render.js:151/183` rendering a literal `'clean'` from an absent `flags` (safe only
because `motionSQI` always returns the array, and the same line treats an absent `conf` honestly as
`'—'`); and `poincareNN || nn` in two nodes (if it ever fell back, the ellipse would stop matching
the cloud — the comment says so, nothing enforces it).

⚠️ **The load-bearing part of the report is §1: three control failures before the scan could be
believed.** A pattern that could not match its own model case and returned **empty across all 26
files** — a clean sweep from an instrument structurally incapable of finding the one defect known to
exist. A fixed version reporting the control at `:314` for a defect at `:404`, because comments were
blanked with spaces that ate their newlines. And a control whose `grep … | head && echo "✓ can see"`
printed the success line on **zero matches** — §4b inside the control that certifies the instrument.
Only the last was caught by habit; the first two were caught by requiring the scan to flag
`9b1ddec0~1`'s known defect before any empty result was trusted.

Docs-only: an `audits/` report plus its `DOCS-INDEX` row. No source, no bundle, no provenance.
