<!--
  DEEP-AUDIT-FIXES-FOLLOWUPS-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-03 · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Follows / executes-residue-of:** [`DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md`](DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md) (DONE 2026-06-30)

# Deep-audit fixes — residue (all LOW)

> Read **`CLAUDE.md`** first (the two gates, the Units mandate, edit-`*.js`/`.src.html`-then-re-bundle).
> This captures what surfaced while executing `DEEP-AUDIT-FIXES` §3 (the GlucoDex mmol/L display
> toggle). Everything the parent shipped is gate-green — `Dex-Test-Suite.html` **all-green 1608/104**,
> `verify-provenance.html` **GATE A 8/8 + GATE B reproducible**. Nothing here blocks anything shipped;
> all items are LOW polish / deferred-by-rationale.

## Resolution — DONE 2026-07-03

Executed per-surface (§1's three surfaces + the §2 docs note). Both code edits are **display-copy only
→ EXPORT-INERT** (no compute / storage / `ganglior.node-export` change).

1. **Profile TARGET-INPUT (`glucoseTargetLo` / `glucoseTargetHi`) — KEEP mg/dL, NO code change.** Since
   this brief was written the field **migrated out of GlucoDex's own profile into the SHARED
   `dex-profile.js` `renderPanel`** (PROFILE-UNIFY): the `gluTgtLo` / `gluTgtHi` inputs no longer exist in
   `GlucoDex.src.html` (which now mounts only `#dexProfilePanel`), and the `lbl_gluTgt` echo the brief
   cited as "already converts" is a **dead no-op** (`glucodex-profile.js` `set('lbl_gluTgt',…)` targets a
   removed element). In the shared **cross-node identity panel** mg/dL is the **canonical stored unit** and
   the label is explicit (`Target low/high (mg/dL)`), so it is unambiguous — not misleading residue.
   Honoring the `GluDisp` toggle here would require editing the **shared module** → re-bundling the
   **entire fleet** + re-recording **every** code-gated fixture's `manifestHash`, disproportionate for a
   LOW single-node item and against the parent's "GlucoDex-only re-bundle" scope. `CLAUDE.md` Units mandate
   is satisfied (store/compute canonical; shown == stored). No GluDisp dependency belongs in the shared panel.
2. **Ganglior event-stream preview (`glucodex-app.js` `renderGanglior`) — KEEP mg/dL + honest clarifier.**
   Added one line to the bus-shape note: *"Glucose values in `meta` mirror the raw `ganglior.node-export`
   — always mg/dL, independent of the display toggle."* (meta keys `riseMgdl` / `minMgdl` already
   self-label; `peak` / `nadir` were bare.) Resolves the only real ambiguity without converting —
   converting would misrepresent the export.
3. **CSV upload-format hint (`GlucoDex.src.html` dropzone) — KEEP format-doc intent, harmonized.**
   `timestamp, glucose(mg/dL)` → `timestamp, glucose`, matching the sibling `#aInfo` hint; the adjacent
   "unit (mg/dL ↔ mmol/L) … auto-detected" clause already documents both accepted units.

**§2 (docs):** one-line mg/dL⇄mmol/L display-switch note added to `how-to-collect/libre-cgm.md` and the
`GlucoDex Reference.html` lede (display-only; compute/export stay mg/dL). Docs-only, no re-bundle.

**Build + gates:** GlucoDex re-bundled `manifestHash 25eaee49bd19→62d38df70558` (`buildHash ebb3b3ab196a`
inert/unchanged per Phase 7). `BUILD-MANIFEST.json` GlucoDex entry + the `GlucoDex_2026-06-27_equiv`
fixture `manifestHash` re-recorded; **`outputHash 1489fce3588bffc2` + inputHashes UNCHANGED** (export-inert
— NOT regenerated). **GATE A 8/8 + GATE B 15/15 reproducible** (GlucoDex fixture `reproducible @
62d38df70558`; verified via the shared `ManifestGate` algorithm). `Dex-Test-Suite` GlucoDex surface
confirmed: `GlucoDex mmol/L display toggle` source-mirror group (18/18 assertions hold — edits add text,
remove no asserted substring) and `env.equiv.glucodex` (its static twin is GATE B, `reproducible`).

**Residue / follow-up:** the dead `lbl_gluTgt` echo in `glucodex-profile.js` (a PROFILE-UNIFY leftover,
no functional impact) is noted here and left per minimal-diff — not worth a re-bundle. **No follow-up
brief spawned.**

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
