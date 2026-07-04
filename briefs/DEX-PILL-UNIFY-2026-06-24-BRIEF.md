<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# DEX-PILL-UNIFY — status-pill class consolidation (optional polish)

**Status:** DEFERRED — 2026-06-24 · **Created:** 2026-06-24 · **Owner brand:** Tepna
**Spawned-by:** `BADGE-PLACEMENT-SWEEP-FOLLOWUPS-2026-06-24-BRIEF.md` §4 (DONE 2026-06-24).
**Deferral note (2026-06-24):** Reviewed and consciously deferred — not abandoned. Two findings make
this low-value at the stated cost: (1) the brief's "render consistently today ⇒ one byte-identical
`.dex-pill` base" premise does NOT hold — `.proj-badge` (10px, radius 20px, borderless), `.readiness-zone-chip`
(12px, radius 999px, bordered) and `.gang-pill` (12px, bordered, `text2`) are three genuinely distinct
shapes; a single base can only share the **severity color axis** (`ok/warn/bad/info`), which already
exists in `ans-design.css §11` as `.pill-green/-yellow/-red/-blue`. (2) **No real cross-file dedup is
possible** under the current architecture: `ans-design.css` is **hand-mirrored** into every app's
`.src.html` `<style>` block (not `<link>`ed), and these pills are mirror-copied across **5 nodes**
(`.proj-badge` → HRVDex/OxyDex/PulseDex; `.readiness-zone-chip` → HRVDex/OxyDex/PulseDex; `.gang-pill`
→ GlucoDex/ECGDex). So even the cheap "color-axis only" variant only collapses a few lines *within*
each file while still paying the full per-node cost (shell `<style>` edit + ANS-DESIGN sha bump +
re-bundle + `BUILD-MANIFEST.json` manifestHash bump + both gates) ≈ a near-full-fleet pass — for zero
visual/functional change. **Revisit only if** `ans-design.css` is ever centralized into a real linked
stylesheet (a separate, larger brief), at which point genuine single-source pill dedup becomes possible.
A comparison preview of both options was built at `DEX-PILL-UNIFY-options.html`.

> Captured while executing the placement-sweep follow-ups. NOT a coverage or correctness gap — the
> evidence-disc system is complete and the disc-vs-pill distinction is correct everywhere (no status
> pill stands in for a missing evidence disc; the VO₂max/Apnea-Bench class of bug was not
> reintroduced). This is purely cosmetic consolidation, safe to defer indefinitely.

## Problem
Status / context pills are styled per-card across several nodes under different class names —
`proj-badge`, `readiness-zone-chip`, `gang-pill`, plus assorted severity pills — each carrying its
own padding / radius / color rules. They render consistently today but the duplication means a future
restyle has to touch N places.

## Proposal
Introduce one shared `.dex-pill` base class (size, radius, weight, neutral surface) with severity
modifiers (`.dex-pill--ok` / `--warn` / `--bad` / `--info`), and migrate the per-card pills onto it.
Keep it visually byte-identical to today's pills so the migration is a no-op on screen.

## Constraints / gotchas
- **This is a `.src.html` `<style>` change** wherever a node's pills live in its shell — that moves
  BOTH `buildHash` AND `manifestHash`, so it forces a re-bundle of every touched node + a
  `BUILD-MANIFEST.json` `manifestHash` bump per node. Plan it as its own deliberate pass, not folded
  into unrelated work.
- The evidence DISCS are out of scope — do not touch `dex-badges.css` / `metric-registry.js` /
  `MetricRegistry.badge()`. Pills ≠ discs; that separation is the whole point.
- Re-run the gates after: `verify-provenance.html` GATE A (8/8 + manifest bumps committed) and
  `Dex-Test-Suite.html` (`cohesion-badges` green) before flipping this to DONE.

## Done when
- One `.dex-pill` base + modifiers defined in the shared CSS surface, per-card pill rules removed.
- No visual diff on any node's pills (spot-check each).
- Re-bundle + `BUILD-MANIFEST.json` updated for every touched node; both gates green.
