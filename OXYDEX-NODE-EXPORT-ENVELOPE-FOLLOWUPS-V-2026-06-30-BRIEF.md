<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-30 · **Created:** 2026-06-30 · **Supersedes-context:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-IV-2026-06-30-BRIEF.md (executed — §1 ECGDex cardiac PB-burden trend recorded already-present-as-`cvhrIndex`; §2 `cite`-in-mapping deferred. Both DECISIONS, no code. See `EVENT-LEXICON.md` §6.7/6.8)

> **EXECUTED 2026-06-30 — and the brief's "inert today" premise was WRONG (corrected on execution):** the
> Integrator Longitudinal view ALREADY badges crossnight metrics. `integrator-longitudinal.js` `evBadge(def)`
> reads `metrics{}.evidence` straight from the envelope on EVERY trend cell + Pearson-coupling card (its own
> comment notes "a node that does not self-describe evidence stays unbadged"). So OxyDex/CPAPDex metrics rendered
> WITH an evidence disc while ECGDex/PpgDex/PulseDex rendered BARE — a **live COVERAGE-MANDATE gap**, not
> speculative future-proofing. §2's defer-condition ("wait until the Longitudinal view consumes evidence") was
> already met → **executed both sections** (the full per-node ritual, not a decision).
> - **§1+§2 DONE (shipped).** Added `evidence:'<tier>'` (sourced VERBATIM from each node's registry) to every
>   crossnight metric def: `ecgdex-cross.js` + `pulsedex-cross.js` (METRICS literals) + `ppgdex-cross.js`
>   (PPG_DEFS). §1 fold-in: the `ppgdex-cross.js` `crossNightBlock` map now forwards `evidence`+`cite` (the
>   OxyDex/CPAPDex-parity fix for the lossy `Object.keys(PPG_DEFS).map` that dropped both). Tiers: ECGDex
>   rMSSD/SDNN/lnRMSSD/QTc validated · Mean HR measured · DFA α1/CVHR index/Decel emerging; PulseDex
>   rMSSD/SDNN/lnRMSSD/Baevsky SI validated · Pulse HR measured · DFA α1 emerging · Stress/HRV Score experimental;
>   PpgDex rMSSD/SDNN/lnRMSSD validated · Pulse HR/Perfusion/Motion-rej measured · Aug. index emerging.
> - **Re-bundles (external-JS-only → buildHash UNCHANGED):** ECGDex a39f09197964→**bd29b2a7ad91**, PulseDex
>   eba6b7d3dcf9→**1a8b99cf8a4c**, PpgDex 13801a1ced0a→**9f4195db258f**.
> - **EXPORT-INERT** for every committed code-gated fixture (evidence lands ONLY in the crossNight block =
>   multi-recording path; the 4 affected fixtures — PulseDex equiv+events, PpgDex equiv, ECGDex equiv — are all
>   SINGLE-recording `compute({text})` exports with no crossNight block → byte-identical, `env.equiv.*` green) →
>   NOT regenerated, manifestHash re-recorded in `FIXTURE-PROVENANCE.json`. The legacy multi-recording uploads
>   (`*multi*`) are buildHash-only/legacy (buildHash unchanged → green-legacy; left as historical per the house
>   legacy-fixture norm).
> - **GATES:** `Dex-Test-Suite.html` all-green (**1547 passed**; `Cross §1` group extended — every crossnight
>   metric self-describes evidence + per-node registry-tier spot-checks across all 5 nodes; "metric def evidence
>   reaches the envelope" + "a consumer can badge it identically" stay green). `verify-provenance.html` **GATE A
>   8/8 + GATE B clean**. `BUILD-MANIFEST.json` `_note_oxydex_envelope_followups_v` records the full rationale.
> - **Residue:** none blocking. The crossnight badge tooltips are evidence-only (no `cite` VALUES on the defs),
>   matching the shipped OxyDex/CPAPDex precedent (most of their crossnight metrics are evidence-only too); the
>   ppg map now FORWARDS cite so a future cited crossnight metric flows through. Enriching all crossnight badges
>   with their registry `cite` tooltips is an OPTIONAL future nicety, not a gap — recorded here, no follow-up brief
>   spawned (would be empty).

# Periodic-breathing fusion — FOLLOW-UPS V

> Residue surfaced while executing `-IV §2` (the `cite`-in-mapping audit). `-IV` was a pure decision pass
> (no code, no re-bundle, no fixture change — neither gate triggered). Auditing the five `<node>-cross.js`
> def→envelope mappings to confirm the `cite` reach exposed a SUPERSET gap on the **`evidence`** field, and
> pinned the exact PpgDex fold-in. **None of the below is a live bug today** — every item is inert in the
> export (the envelope tolerates `evidence:null`/`cite:null`) and cosmetic until the Integrator Longitudinal
> view starts BADGING crossnight metrics. All LOW.

---

## §1 — PpgDex `crossNightBlock` map drops BOTH `evidence` and `cite` · LOW (the lone real `-IV §2` drop)

`-IV §2` established that of the three crossnight emitters it listed, **only PpgDex** actually has a lossy
def→envelope mapping: `ppgdex-cross.js` `crossNightBlock` builds its metric array via
`Object.keys(PPG_DEFS).map(function(id){ var d=PPG_DEFS[id]; return { id:id, label:d.label, unit:d.unit,
goodDirection:d.good, get:d.get }; })` — which omits **both** `evidence` and `cite`. (ECGDex + PulseDex pass
their `METRICS` array literal straight into `CrossNightEnvelope.build`, so `_shapeMetric`'s `evidence:m.evidence||null`
+ `cite:m.cite||null` already forward anything those entries carry — they have no lossy mapping to fix.) It is
inert today: `PPG_DEFS` carries neither field on any def, so every PpgDex crossnight metric legitimately surfaces
`evidence:null`/`cite:null`. The OxyDex + CPAPDex mappings (fixed in `-III §1`) already emit
`evidence:d.evidence, cite:d.cite`.

**Do (when PpgDex is next re-bundled for another reason, OR when it first needs a graded/cited crossnight metric):**
bring the PpgDex map to parity with OxyDex/CPAPDex —
`return { id:id, label:d.label, unit:d.unit, goodDirection:d.good, evidence:d.evidence, cite:d.cite, get:d.get };`
— and add the matching `evidence:'<tier>'` (from `ppgdex-registry.js`) and any `cite:'…'` onto the `PPG_DEFS`
entries. ⚠️ Code change to one bundled module → re-bundle PpgDex + update `BUILD-MANIFEST.json` (export-inert
while the defs carry no grade, so no metric VALUE changes, but `manifestHash` moves on the JS edit) + both gates.
Per the CLAUDE.md BADGE_CSS precedent, do NOT drive a standalone PpgDex rebuild for this alone while it stays
inert — fold it into the next PpgDex rebuild, or do it as part of §2 below.

## §2 — Crossnight metric `evidence` grade is ABSENT for 3 of 5 nodes · LOW (fleet consistency; gates the longitudinal badge)

The same audit shows a fleet inconsistency one level up from `cite`: the **`evidence`** grade is carried into the
`ganglior.crossnight` envelope by only **OxyDex + CPAPDex** (their `_DEFS` carry `evidence` and their maps forward
it). **PpgDex, ECGDex, PulseDex** all surface `evidence:null` for every crossnight metric — PpgDex because its map
drops it (§1), ECGDex + PulseDex because their `METRICS` literals simply don't include an `evidence` field on any
entry (e.g. ECGDex `{ id:'rmssd', label:'rMSSD', unit:'ms', goodDirection:'up', get:… }` — no `evidence`). Yet the
node registries DO grade every one of these (e.g. `ecgdex-registry.js`: rmssd/sdnn **validated**, dfaAlpha1 /
cvhrIndex / decelCapacity **emerging**; `pulsedex`/`ppgdex` registries likewise). So the grade EXISTS at the
node — it just isn't plumbed into the crossnight envelope for 3 nodes.

It is inert in the export today (the Integrator Longitudinal view trends/couples on the numbers; it does not yet
read `metrics{}.evidence`). But the CLAUDE.md **COVERAGE MANDATE** ("every surfaced measurement carries an
evidence badge, no exception") means the moment the Longitudinal view badges its crossnight metrics, the 3
ungraded nodes would render unbadged — a bug. Unlike `cite` (§-IV §2, where ECGDex/PulseDex needed nothing), this
requires a real source edit to ALL THREE: add `evidence:'<tier>'` (from each node's registry) to every `METRICS`/
`PPG_DEFS` entry, with the values sourced from — and ideally gate-checked against — the registry grade.

**Decide + (if yes) do:** whether to grade the crossnight metrics fleet-wide now, or wait until the Integrator
Longitudinal view consumes `evidence`. If taken, it is a deliberate **3-node pass** (PpgDex + ECGDex + PulseDex):
add the `evidence` field per registry to each node's crossnight metric defs (folding §1's PpgDex `cite` in at the
same time), re-bundle each + update `BUILD-MANIFEST.json`, and consider extending the shared `Cross §1` test group
(`tests/dex-tests.js`) to assert each crossnight metric's `evidence` equals its registry grade (mirrors the
`cohesion-badges` reference-guide↔registry parity check, so the envelope can't drift from the registry). Honor
both gates per the per-node ritual. If deferred, record that crossnight `evidence` stays node-local until the
Longitudinal view badges (then this is the enabling pass).

---

## Done when
- [x] §1 PpgDex map `evidence`+`cite` parity fold-in recorded. **DONE** — folded into the §2 rebuild:
      `ppgdex-cross.js` `crossNightBlock` map now emits `evidence:d.evidence, cite:d.cite`; PPG_DEFS gained the
      evidence tiers. PpgDex re-bundled 13801a1ced0a→9f4195db258f.
- [x] §2 crossnight-`evidence` fleet-grading decision recorded. **DONE (shipped, not deferred)** — the
      Longitudinal view ALREADY badges crossnight evidence (evBadge), so the defer-condition was already met.
      Graded ECGDex+PulseDex+PpgDex from their registries + extended the `Cross §1` test with the
      evidence-present invariant + per-node registry-tier spot-checks across all 5 nodes.
- [x] Every code-touching item honors the re-bundle + `Dex-Test-Suite` / `verify-provenance` gates. **DONE** —
      3 re-bundles (buildHash-stable), Dex-Test-Suite all-green (1547 passed), verify-provenance GATE A 8/8 +
      GATE B clean; BUILD-MANIFEST (3 hashes) + FIXTURE-PROVENANCE (4 fixtures, EXPORT-INERT) re-recorded.
