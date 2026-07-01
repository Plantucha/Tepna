<!--
  GLUCODEX-HYPO-DISAMBIG-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Build Brief — GlucoDex: stop the compression-rejection from eating genuine sharp nocturnal hypos

**Status:** DONE — 2026-06-23 · **Created:** 2026-06 (undated)
<!-- Verified 2026-06-23: _looksLikeGenuineHypo() discriminator + guard added to glucodex-dsp.js so a
     sustained deep sub-70 run survives compression-rejection into nocturnalHypo(); permanent two-direction
     assertions in tests/dex-tests.js (genuine sharp hypo fires; near-vertical positional artifact still
     rejected; viewer-tz independent). GlucoDex re-bundled (manifestHash 653317f49b73→ad57c3ff4cc2) +
     BUILD-MANIFEST.json updated; papers updated (papers.html RESOLVED·detector, cgm-hrv-coupling §3.3,
     GlucoDex Reference.html). No committed GlucoDex uploads fixture → FIXTURE-PROVENANCE sidecar N/A.
     No follow-up surfaced. -->

> **For the AI coder (next thread).** Read **`CLAUDE.md` first** — this edits a `*-dsp.js`, so it is
> **gate-protected**: you MUST run `Dex-Test-Suite.html`, re-bundle GlucoDex, update `BUILD-MANIFEST.json`,
> run `verify-provenance.html`, and regenerate GlucoDex fixtures. Do NOT half-apply it. Scope to ONE
> deliberate pass. Edit the `.js` + `.src.html`, never the bundled `.html`.

---

## 0. Why (the finding this closes)

A real, shipped GlucoDex **false negative**, found June 2026 while fixing the cgm-hrv-coupling pilot's
hypo arm (see `papers/cgm-hrv-coupling.html` §3.3 and the RESOLVED·detector entry in
`papers/papers.html`):

- The synthetic (and clinically real) nocturnal hypo is a **sharp drop + Somogyi rebound**: glucose
  dives to **~56 mg/dL for ~50 min** (~10 cells < 70 at 5-min cadence) then rebounds.
- GlucoDex's compression-artifact rejection (`computeBaselineArr` / the positional-artifact bracketing
  in `glucodex-dsp.js`, ~lines 200–215) treats a **drop-and-recover bracket** as a sensor-pressure
  artifact, flags those cells (`f===3`), and **excludes them from `nocturnalHypo` events**.
- Result: the cleaned-series `nocturnalHypo` flag recovered **0.008 (≈4/479)** of planted hypos; a
  flag-independent **window-local time-below-70** recovered **1.00 (479/479)**. Proven by probing the
  raw slice (seed 6: min 56 mg/dL, 10 cells < 70) — the dip is genuinely in the data; the detector
  drops it.
- **Real-world stakes:** a user with a real sharp insulin hypo + Somogyi rebound (a clinically
  dangerous "dead-in-bed"-adjacent pattern) would have it **silently suppressed** in the GlucoDex app.

**The pilot + Integrator already work around it** (raw window-local time-below-70 in
`cohort-worker.js` `cgmcouple` and `integrator-dsp.js` `glucoseMetricsInWindow`). This brief fixes the
**source detector** so the standalone GlucoDex app stops dropping true hypos.

## 1. The bug, precisely

In `glucodex-dsp.js`:
- `nocturnalHypo(c)` (~line 577) finds 00:00–06:00 runs ≥15 min < 70 mg/dL — but it runs on the
  **cleaned** series, where compression-flagged cells are already excluded.
- The compression/positional-artifact pass (~lines 200–215, comment: *"bracketing-recovery signature
  separates a positional artifact from a genuine insulin nocturnal hypo (gradual, within an
  already-low trend)"*) is **too aggressive**: a true hypo's recovery shoulder is the exact bracket it
  screens for, so a genuine sharp hypo is misclassified as artifact.

The existing comment already names the intended discriminator ("gradual, within an already-low
trend") — it just isn't enforced strongly enough against a sharp Somogyi rebound.

## 2. The fix (disambiguate true hypo vs compression artifact) — keep it conservative

**Goal:** a genuine sustained sub-70 excursion is NOT discarded as a compression artifact, while real
positional artifacts still are. Do the minimum that separates them; do not retune anything else.

Candidate discriminators (pick the smallest set that passes §4), all computable from the series:
- **Duration/depth floor:** a true hypo sits < 70 for a sustained run (≥~15 min, ≥~3 cells) and reaches
  a real nadir (e.g. ≤ ~60 mg/dL). A compression artifact is typically briefer and/or shallower and
  recovers within a cell or two. Do **not** flag-as-artifact a sub-70 run that meets the sustained
  floor — let it through to `nocturnalHypo`.
- **Slope asymmetry:** positional artifacts drop AND recover near-vertically (one–two cells each way);
  an insulin hypo descends/rebounds over multiple cells. Gate artifact-classification on
  near-instant (single-cell) drop+recover, not on any drop-recover bracket.
- **Trend context:** "within an already-low trend" — a dip from an already-depressed baseline is more
  likely real; a dip from a normal baseline that snaps back is more artifact-like. Use the existing
  baseline machinery, don't add a new one.

**Implementation shape (additive, back-compat — the test assertions ARE the public contract):**
- Add a guard in the compression/positional-artifact classifier so a cell run that satisfies the
  **sustained-hypo** criteria above is **NOT** marked `f===3` (or is marked with a NEW
  "suspected-hypo, not artifact" disposition) and therefore **survives into `nocturnalHypo`**.
- Prefer adding the discriminator as a new internal helper + a new optional param/return field over
  changing existing signatures. If you must change behavior of an existing fn, keep its signature and
  return shape; expose new info via a NEW field.
- Consider surfacing, in the GlucoDex app UI (`glucodex-app.js` patterns section), a one-line note when
  a dip was **borderline artifact-vs-hypo** so a real user isn't misled either way (optional, only if
  cheap and within the existing UI vocabulary).

## 3. Files

- **`glucodex-dsp.js`** — the discriminator + the guard so sustained sub-70 runs reach `nocturnalHypo`.
- **`glucodex-registry.js`** — only if you add/retier a metric (you probably do NOT; this is a recall
  fix, not a new metric). Evidence tiers are node facts — don't invent grades.
- **`glucodex-app.js`** — optional UI note (§2), only if trivially in-vocabulary.
- **`GlucoDex.src.html`** — only if an include changes (it shouldn't).
- Do **NOT** touch `cohort-gen.js` / `synth-gen.js` (generators) or the already-fixed
  `cohort-worker.js` / `integrator-dsp.js`.

## 4. Verification (do ALL — this is gate-protected)

1. **Regression gate:** open `Dex-Test-Suite.html`, wait ~3 s, `#summary` must be **all green**. If you
   changed a signature/return shape, you broke the contract — restore back-compat instead. Node CI
   shares `tests/dex-tests.js`.
2. **The actual fix (new spot-check):** run real GlucoDex `analyze` on a known sharp-hypo input (e.g.
   regenerate seed 6's hypo-night slice, or a hand-built CSV that dips to ~56 mg/dL for ~50 min with a
   Somogyi rebound). Assert `nocturnalHypo.length > 0` (was 0). Add this as a permanent assertion in
   `tests/dex-tests.js` so the false-negative can't regress.
3. **No new false positives:** a genuine brief positional artifact (sharp 1–2-cell drop+recover, no
   sustained sub-60 nadir) must still be flagged and still excluded — assert `nocturnalHypo` does NOT
   fire on it. This is the whole point: separate the two.
4. **Clock contract:** any new time logic uses `getUTC*` only; re-render under a changed `TZ` →
   identical hypo detection (viewer-tz independent).
5. **Re-bundle:** `GlucoDex.src.html → GlucoDex.html`; no console errors; standalone matches.
6. **Provenance:** open `verify-provenance.html`. A JS change **moves `manifestHash`** (even if
   `buildHash` doesn't) → **hand-update GlucoDex's entry in `BUILD-MANIFEST.json`** to the new
   `manifestHash` (read it off the page's manifestHash column) or GATE A reads stale / HARD-FAILS.
7. **Fixtures:** GlucoDex CODE changed → **regenerate its `uploads/*.json` fixtures** by re-running the
   app on its inputs and re-exporting (never hand-edit), then record the producing bundle's
   `manifestHash` in `FIXTURE-PROVENANCE.json`. Don't rely on `buildHash` moving — for an external-JS
   change it won't.

## 5. After it lands (paper/doc updates)

- `papers/papers.html` RESOLVED·detector entry: append that the **shipped GlucoDex** detector is now
  fixed too (not just pilot+fusion workaround) + the new permanent test.
- `papers/cgm-hrv-coupling.html` §3.3: the "GlucoDex trades hypo recall for artifact robustness"
  tradeoff sentence should be softened to past tense / "now disambiguated in-detector."
- `GlucoDex Reference.html`: if the hypo-flag behavior/tier description changes, update it (the
  reference guide is the consumer that must conform to the registry — fix the doc, not the registry).
- Optionally regenerate `papers/figures/cgm-hrv-coupling.png` hypo panel from the enriched run.

## 6. Done criteria

- A genuine sharp nocturnal hypo (sustained sub-70, e.g. ~56 mg/dL ~50 min, with Somogyi rebound) is
  **detected** by GlucoDex `nocturnalHypo`; a brief positional artifact is still rejected.
- A permanent assertion in `tests/dex-tests.js` locks both directions (true hypo fires, artifact
  doesn't). `Dex-Test-Suite.html` all green.
- GlucoDex re-bundled; `BUILD-MANIFEST.json` updated; `verify-provenance.html` no red; GlucoDex
  fixtures regenerated + recorded in `FIXTURE-PROVENANCE.json`.
- `glucodex-dsp.js` signatures/returns back-compat (new info via new fields only).
- Papers/reference docs updated to "fixed in-detector," clock contract intact, 100% local.
