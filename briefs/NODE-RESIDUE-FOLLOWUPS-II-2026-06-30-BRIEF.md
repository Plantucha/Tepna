<!--
  NODE-RESIDUE-FOLLOWUPS-II-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-02 (§1 DECIDED *intentional asymmetry* — no symmetric ECGDex SQI floor; §2 DECIDED `sqiFloor`/`clampFloor` are *audit-only* — the `conf ×0.5` is load-bearing; both annotated at the floor sites in `integrator-dsp.js` + EVENT-LEXICON §6.10. §3/§4/§5 no-action per recorded rationale. Integrator re-bundled `fe4c2c623820→be7e7aa83355`, GATE A updated; Integrator GATE A/B clean, FIXTURE-PROVENANCE untouched (only historical byte-pinned fusions). ⚠ A PRE-EXISTING, UNRELATED OxyDex ledger drift was discovered during the gate check — NOT introduced by this brief — and handed to NODE-RESIDUE-FOLLOWUPS-III.) · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Executed-residue-of:** NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md §3 (DONE 2026-06-30 — PpgDex `event.sqi`
sqi-floor WIRED into the Integrator).

# Residue from wiring the PpgDex SQI-floor (what the §3 execution exposed)

> Read **`CLAUDE.md`** first (the two gates, the Clock Contract, frozen `Ganglior`, edit-`*.js`/`.src.html`-
> then-re-bundle). This brief captures what surfaced while executing NODE-RESIDUE-FOLLOWUPS §3 — the
> Integrator PpgDex sqi-floor (`PPG_SQI_FLOOR = 0.3`; a PpgDex event with `sqi < 0.3` gets `conf ×0.5` +
> a `sqiFloor` tag at ingest, mirroring the GlucoDex clamp-floor, complementary to the fleet-generic
> `effConf = conf×(sqi??1)` proportional taper). **Everything §3 shipped is gate-green** (Dex-Test-Suite
> 1614/105 all-green incl. the Integrator render-coverage rig 9/9; verify-provenance GATE A/B +
> `__provenanceOK`; Integrator re-bundled `215fe4dc22d0→2ba8d6a61cb8`). Nothing here blocks anything
> shipped; all items are LOW / decision / audit-honesty. §1 is the one worth deciding.

---

## 1 · ECGDex has NO symmetric sqi-floor — decide PARITY vs intentional asymmetry (DECIDE, LOW) ⚠ headline

**What surfaced.** ECGDex surges ALSO carry a per-event `sqi` (`ecgdex-dsp.js` stamps `sqi:+sqiAt(ev.sec)`
on `autonomic_surge`, exactly like PpgDex), and ECGDex is a first-class apnea corroborator — `fuseApneaEvents`
gathers surges from `ECGDex.concat(PpgDex)` and `effConf` already tapers BOTH proportionally by `sqi`. But
§3 added the CATEGORICAL floor **only to the `node==='PpgDex'` branch** of `adaptEnvelopeNode`. So today a
low-`sqi` ECGDex surge is tapered *proportionally* (effConf) but NOT *categorically* floored, while an
identical-`sqi` PpgDex surge gets BOTH. That asymmetry is currently **undocumented** — it reads as an
oversight, not a decision.

**Two honest readings (pick one, record it):**
- **Intentional (my lean):** PpgDex is **limb-worn optical** (Polar Verity Sense) — motion-prone, its `sqi`
  legitimately dips into the unusable tail, so the extra categorical distrust is warranted. ECGDex is a
  **chest-strap** (Polar H10) — its `sqi` rarely drops below `0.3` on a real recording, so effConf's smooth
  taper suffices and a floor would almost never fire. If so: **document the asymmetry** in EVENT-LEXICON §6.9
  + at the PpgDex-branch floor site (one comment: "no ECGDex floor — chest-strap SQI rarely reaches the
  unusable tail; effConf's proportional taper covers it"). **Zero re-bundle** (comment-only if you keep it
  Integrator-side… actually a comment in `integrator-dsp.js` IS a re-bundle — see gate cost).
- **Symmetric:** low-SQI is low-SQI regardless of source. Then **generalize** the floor: replace the
  PpgDex-only literal with a small `NODE_SQI_FLOOR = { PpgDex:0.3, ECGDex:0.25 }` (ECG floor lower — chest
  quality bar is higher) consulted in a SHARED post-map step that runs for any node whose events carry `sqi`,
  and add an ECGDex-branch (or shared-loop) test twin of the §3 group.

**Gate cost (either way it touches `integrator-dsp.js`):** re-bundle **Integrator.html** + GATE A
(`BUILD-MANIFEST.json`) per the CLAUDE.md §🔏 checklist; FIXTURE-PROVENANCE untouched (Integrator has only
historical byte-pinned fixtures; no code-gated manifestHash to move). If you go symmetric, add the ECGDex
leg to the Dex-Test-Suite group in **both** runners. **Decide first** — it is a fusion-semantics/scope
decision, not mechanical.

## 2 · Is `sqiFloor` (and its sibling `clampFloor`) LOAD-BEARING or audit-only? (VERIFY → DECIDE, LOW)

**What surfaced.** The §3 floor sets `_pe.sqiFloor = true` **and** halves `conf`. The **conf** down-weight is
genuinely load-bearing (it flows through `effConf` → the noisy-OR → the posterior). But the **`sqiFloor` TAG
itself** — is it read anywhere (surfaced in `buildFusionExport`'s finding `sources[]`, or on an Integrator
render card), or is it purely an audit breadcrumb? I mirrored GlucoDex's `clampFloor`, which has the **same
open question** — and this is exactly the shape of the already-documented `meta.derived` situation (see the
`effConf` header note in `integrator-dsp.js`: "audit-only today — NOT consumed by fusion … do NOT assume the
tag is load-bearing in the posterior"). Risk: a future reader assumes `sqiFloor`/`clampFloor` gate something
they don't.

**Do:** (a) grep `integrator-dsp.js`/`integrator-render.js`/`integrator-app.js` for `clampFloor`/`sqiFloor`
consumption. (b) If NOT surfaced: add a one-line "audit-only today (the conf ×0.5 is the load-bearing part;
the tag is provenance)" note beside BOTH the `clampFloor` and `sqiFloor` stamps, matching the `meta.derived`
precedent. (c) If it SHOULD be surfaced: emit a "quality-floored source" marker on the apnea finding's
`sources[]` (the `sources[]` already carry per-source `sqi`/`effConf`, so `sqiFloor:true` is a natural add) +
a test. Test-layer/doc = no re-bundle; a source-shape change = Integrator re-bundle + GATE A.

## 3 · The floor fires on NON-fused PpgDex impulses (hrv_drop / motion_artifact_segment) — inert today (NOTE)

The §3 loop floors **any** sub-`0.3`-`sqi` PpgDex event, but only `autonomic_surge` is consumed by fusion
(the apnea `gather()` set is `autonomic_surge`/`autonomic_arousal`; `hrv_drop` + `motion_artifact_segment` are
node-scoped, EVENT-LEXICON §2, not gathered). So flooring `hrv_drop`/`motion_artifact_segment` currently has
**no effect on any posterior** — it is harmless, keeps the ingested record internally consistent, and
future-proofs the day one of those impulses becomes a fusion consumer. **No action** unless/until that
happens; recorded so it isn't mistaken for a live down-weight.

## 4 · Calibration is UNVALIDATED — `PPG_SQI_FLOOR=0.3`, the `×0.5` penalty, and the effConf stack (DEFER, LOW)

`PPG_SQI_FLOOR=0.3` (chosen below the `sqi≥0.5` "clean-beat" line, above a "totally unusable" tail), the
`×0.5` penalty (copied from the GlucoDex clamp-floor), and the DELIBERATE stacking (categorical `×0.5` THEN
proportional `effConf ×sqi` → a sub-floor surge contributes `≤0.15×`) are **rule-of-thumb heuristics never
tuned against a labeled corpus** — same evidentiary class as `PB_CVHR_MIN` (EVENT-LEXICON §6.4, deliberately
Integrator-local + unvalidated). **Do (when a labeled apnea corpus exists):** sweep floor/penalty against
confirmed-apnea precision/recall on real low-SQI PPG nights; until then LOW, leave as-is. The stack is
documented as intentional (EVENT-LEXICON §6.9) so it should not be "fixed" as a double-count bug.

## 5 · Standing debt carried forward (environmental — same as parent §4)

- **Node-CI** — `node tests/run-tests.mjs` was NOT run (no Node host in this environment). The new group
  *"Integrator PpgDex sqi-floor down-weight (§3)"* runs identically in both runners by construction (shared
  `tests/dex-tests.js`), and its source-mirror leg reads `env.sources['integrator-dsp.js']` which both runners
  populate. Run when a Node host is available.
- **Live-UI drop-zone** (parent §4) — unchanged; the sqi-floor is on the headless ingest path, fully gated.

---

## Acceptance (any PR off this brief)
- [ ] Edited `*-dsp.js` / docs — never a bundled `*.html` by hand; re-bundled affected node(s) if code moved
      (an ECGDex-parity floor or a `sqiFloor`-surfacing change is an `integrator-dsp.js` edit → Integrator re-bundle).
- [ ] `Dex-Test-Suite.html` all-green; `verify-provenance.html` GATE A/B clean; `BUILD-MANIFEST.json` updated
      on any re-bundle (FIXTURE-PROVENANCE untouched — Integrator has only historical byte-pinned fixtures).
- [ ] No new unbadged metric; Clock Contract untouched; `sqi` stays ALONGSIDE `conf` (R7, never folded);
      no cross-node runtime dependency; the canonical `ganglior_events` (+ `sqi` axis) preserved.

## Cross-references
- `NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md` §3 — the executed parent (the sqi-floor wire-up this brief is
  residue of).
- `EVENT-LEXICON.md` §6.9 (the PpgDex sqi-floor policy) · §6.4 (`PB_CVHR_MIN` Integrator-local-unvalidated precedent).
- `integrator-dsp.js` — `effConf` header note (the `meta.derived` "audit-only, not load-bearing" precedent §2 mirrors);
  `PPG_SQI_FLOOR` def + the PpgDex-branch floor loop; the GlucoDex `clampFloor` loop it mirrors.
- `CLAUDE.md` §🧪 (test gate) · §🔏 (provenance gate + re-bundle checklist).
