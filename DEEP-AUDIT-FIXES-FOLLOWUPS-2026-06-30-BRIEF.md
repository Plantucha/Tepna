<!--
  DEEP-AUDIT-FIXES-FOLLOWUPS-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Follows / executes-residue-of:** [`DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md`](DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md) (DONE 2026-06-30)

# Deep-audit fixes — residue (all LOW)

> Read **`CLAUDE.md`** first (the two gates, the Units mandate, edit-`*.js`/`.src.html`-then-re-bundle).
> This captures what surfaced while executing `DEEP-AUDIT-FIXES` §3 (the GlucoDex mmol/L display
> toggle). Everything the parent shipped is gate-green — `Dex-Test-Suite.html` **all-green 1608/104**,
> `verify-provenance.html` **GATE A 8/8 + GATE B reproducible**. Nothing here blocks anything shipped;
> all items are LOW polish / deferred-by-rationale.

## Context — what §3 shipped

A read-only **mg/dL⇄mmol/L display toggle** on GlucoDex. Compute + storage + the `ganglior.node-export`
**stay mg/dL** (the CGM consensus + LBGI/HBGI/GMI/J-index constants are authored there); a `GluDisp`
helper (`glucodex-render.js`, exposed `window.GluDisp`) reformats **every surfaced glucose
value/threshold/axis at the render boundary only** — mmol band edges use the internationally
standardized consensus cutoffs (3.0/3.9/10.0/13.9), not naive ÷18.018. Default is **mg/dL** (a metric
unit, and the consensus-native one; mmol/L is the SI molar alternate switch). GlucoDex re-bundled
`267987038e2f→650c1738827e` (export-inert). Both unit modes verified in-page.

---

## §1 · Three GlucoDex surfaces deliberately left mg/dL (decide per-surface)

The toggle converts everything a user **reads as a metric** on a dashboard card. Three surfaces were
scoped OUT on purpose; each is defensible as-is, but a future pass may want to revisit:

1. **Advanced profile TARGET-INPUT fields** (`gluTgtLo` / `gluTgtHi`, labels "Target low/high (mg/dL)"
   + the "consensus default 70/180 mg/dL" hint). These are **user-entered numbers**, so honoring the
   toggle means a real **bidirectional input-boundary conversion** (parse mmol on entry → store mg/dL;
   render mg/dL→mmol in the field + the placeholders + the `lbl_gluTgt` echo already converts). That is
   the genuinely risky part (round-trip parsing, validation ranges, the `DexProfile.setManual` write
   path) and was excluded from a *display*-only toggle. **Do:** if wanted, convert at the input
   boundary only (read field → ×18.018 to mg/dL immediately; never store mmol), mirroring the
   `CLAUDE.md` Units mandate. Keep the numeric store mg/dL. Gate: display+input test both unit modes;
   GlucoDex display-only re-bundle (export still inert).
2. **Ganglior event-stream preview** (`renderGanglior` — the on-screen `{ "t":…, "impulse":…, meta }`
   list + the "canonical bus shape" code sample). Its `meta` numbers (e.g. hypo `min`, excursion
   `rise`/`peak`) are shown in **mg/dL because the stream mirrors the actual `ganglior.node-export`,
   which IS mg/dL**. **Decision: keep mg/dL** (it is an export preview, not a metric readout — showing
   export units is the honest choice). Revisit only if users read it as a dashboard metric.
3. **CSV upload-format hint** ("timestamp, glucose(mg/dL)"). A **file-format example** (GlucoDex
   auto-detects mg/dL *or* mmol/L on import). **Decision: keep** — it documents the accepted input, not
   a displayed value.

## §2 · Optional — record the mmol/L display in the how-to / reference docs

`how-to-collect/libre-cgm.md` and the GlucoDex reference guide describe mg/dL only. A one-line note that
the dashboard has a mg/dL⇄mmol/L display switch (compute stays mg/dL) would close the docs gap. Docs
only — no re-bundle, no gate impact.

## §3 · Standing carry-forward (unchanged by this pass)

- **Node-CI (`node tests/run-tests.mjs`) not run** (no Node host in this environment). The new
  `GlucoDex mmol/L display toggle` group is a **source-mirror** over `glucodex-render.js` +
  `glucodex-app.js` + `glucodex-dsp.js`, all now in BOTH runners' source lists, so it executes
  identically in Node by construction. Same standing debt as the sibling briefs.

---

## Acceptance (any PR off this brief)
- [ ] If converting the profile target INPUTS (§1.1): conversion is **input-boundary only** (store stays
      mg/dL); both unit modes correct end-to-end; GlucoDex re-bundled; `manifestHash` updated; the
      `GlucoDex_2026-06-27_equiv` fixture stays export-inert (re-record only).
- [ ] `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean. Compute/storage/export
      stay mg/dL (Units mandate — one metric NORMS/formula set); no `ganglior.node-export` unit change.
