<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Supersedes-context:** OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27-BRIEF.md (executed) · **Follow-ups:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II-2026-06-29-BRIEF.md

# OxyDex node-export v2.0 envelope — FOLLOW-UPS

> Residue surfaced while executing `OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27-BRIEF.md` (the unconditional
> v2.0 envelope + real `ganglior_events[]`). Parent is DONE + gate-green; these are the threads it
> deliberately left open (the parent's §7 + new findings from execution). None is a regression in the
> shipped pass — they are alignment / coverage work.

---

## §1 (⚠ highest) — Impulse-vocabulary reconciliation (the parent's §7, now concrete)

OxyDex now emits the honest SpO₂-proxy vocabulary **`desat_event`** + **`periodic_breathing`**. The rest
of the fleet still speaks a DIFFERENT vocabulary for the same physiology:
- `integrator-dsp.js` `fuseApneaEvents` gathers OxyDex desats as **`spo2_desaturation`** — execution
  bridged this by gathering BOTH (`['spo2_desaturation','desat_event']`), so apnea fusion is NOT broken,
  but the two names now coexist for one concept.
- The Integrator's **synthetic generator** (`integrator-app.js` ~line 290–298) still fabricates
  `spo2_desaturation` (OxyDex) + `autonomic_surge` (ECGDex) for its demo path.
- ECGDex emits **`autonomic_surge`**; OxyDex's *old* synthesis emitted **`autonomic_arousal`** (see §2).

**Decide a single canonical lexicon** for the desaturation / arousal / surge family and migrate ALL
emitters + the fusion `gather()` sets + the synthetic generator to it (keep back-compat aliases in the
gather sets for one cycle). Land it as a small **EVENT-LEXICON** spec so a new node can't re-fork the
names. This is the real "align the vocabulary" item; the parent only did the minimal non-breaking bridge.

## §2 — The v2.0 path drops OxyDex's synthesized `autonomic_arousal`

The legacy Integrator synthesis emitted, per OxyDex night, BOTH `spo2_desaturation` (from
`desatProfile`) AND `autonomic_arousal` (from `hr_spikes`). The v2.0 envelope emits **only**
`desat_event` + `periodic_breathing` (the parent's §2 modeled exactly two impulse types), so when
`adaptOxyDex` consumes the authoritative top-level stream it **no longer produces OxyDex
`autonomic_arousal`** events.

- This did NOT break apnea fusion: the confirming "surge" side is gathered from **cardiac** nodes
  (ECGDex/PpgDex), never OxyDex — so OxyDex `autonomic_arousal` was never a fusion input. It only
  affected the OxyDex event *timeline/count* surfaced in the Integrator render.
- **Decide:** either (a) leave it dropped (HR-spike "arousals" off a 1 Hz pulse are a soft proxy — the
  parent deliberately modeled only desats + PB, which is the more honest floor), or (b) add a third
  honest impulse (e.g. `pulse_surge`, lower tier) to `oxyBuildGangliorEvents` from `hr_spikes`. Tie the
  decision to §1's lexicon. Recommendation: (a) unless the render specifically needs the markers back.

## §3 — OxyDex `periodic_breathing` has no fusion semantics yet

OxyDex now puts `periodic_breathing` on the bus (like CPAPDex already does). Nothing in
`integrator-dsp.js` does anything with it beyond carrying it in the event list — there is no
**cross-node PB corroboration** (OxyDex-oscillation ↔ CPAPDex-PB ↔ ECGDex CSR/CVHR) and no surfaced
"periodic-breathing burden" finding. Define whether PB should: corroborate across nodes (a PB seen by
two signals is stronger), feed a longitudinal PB-burden trend, and/or surface as its own finding with
the experimental badge. Keep it down-weighted (it is `experimental` by registry).

## §4 — Audit the other nodes for unconditional-envelope conformance (parent §7)

OxyDex was the *only* node still emitting a bare top-level array below a night threshold. The others
(`ECGDex`/`PulseDex`/`HRVDex`/`GlucoDex`/`PpgDex`/`CPAPDex`) emit a `ganglior.node-export` object with
`recording` + `ganglior_events[]` from their `compute()` / app paths — so the drift class the parent
fixed is likely **OxyDex-specific**. CONFIRM that per node (one quick read of each `*-app.js` export +
`compute()`): does any node have a sub-threshold branch that emits a bare array or omits the
`ganglior_events` key? If clean, record "no other node forks" and close. Do NOT batch-edit nodes blind.

## §5 — Historical bare-array loose samples (currency, LOW)

Two committed loose samples remain **bare per-night arrays** (pre-envelope shape):
`uploads/OxyDex_2026-06-27_0745_summary.json` (the 2-night file the parent inspected as "the bug") and
`uploads/oxydex-2026-06-12.summary.json` (the Integrator "Load bundled samples" button). Both are
**ungated** (not in `FIXTURE-PROVENANCE.json`, not value-tested) and the **tolerant reader ingests them
fine by design** — this is exactly the back-compat the parent's tolerant reader guarantees, so nothing
is broken. For *currency* only, optionally re-generate them as v2.0 envelopes by re-running the real app
on their committed O2Ring input CSVs (`…20260525…` + `…20260526…` for `_0745`) — never hand-edit (house
rule). Low priority; leaving them as bare arrays is a valid "old fixtures keep passing" outcome.

---

## Done when
- [x] §1 a single event lexicon is decided + the live-forking emitters migrated (back-compat aliases
      for one cycle); an EVENT-LEXICON note pins it. → **`EVENT-LEXICON.md`** written (canonical
      `desat_event` / `autonomic_surge` / `periodic_breathing` + alias/deprecation policy); the
      Integrator-side desat naming (`integrator-app.js` genSynthetic + `integrator-dsp.js` legacy
      synthesis) migrated to `desat_event`; gather sets keep the aliases. **CPAPDex's `desat` emitter
      migration deferred to -II** (needs a CPAPDex re-bundle + golden regen — the spec lists it as the
      one remaining emitter; the alias keeps it fusing meanwhile).
- [x] §2 the `autonomic_arousal`-drop decision recorded → **leave dropped** (option a; EVENT-LEXICON §3).
- [x] §3 OxyDex `periodic_breathing` fusion semantics — **explicitly deferred to -II with a reason**
      (it is a new cross-node corroboration FINDING + render surface, a feature not a cleanup).
- [x] §4 other-node envelope-conformance audit recorded → **no other bare-array fork** (every other
      node already wraps multi-record exports in an OBJECT: `recordings`/`sessions`/`nights`).
- [x] §5 loose samples → **left as tolerant-reader-covered legacy** (ungated, back-compat by design;
      EVENT-LEXICON / parent tolerant reader covers them). A valid "old fixtures keep passing" outcome.
- [x] Code-touching items honored the gates: Integrator re-bundled `9b9ecbb2351d→ab5333eb44e5`
      (buildHash `78e04e861cce` UNCHANGED); Dex-Test-Suite all-green (incl. the new 9/9 lexicon group);
      verify-provenance GATE A 8/8 + GATE B clean.

---

## Execution note (2026-06-29)

Executed as its own pass. **Audit first** (mapped every `impulse:` across the fleet), then decided +
migrated the low-risk fork, pinned the rest in a spec, and deferred the genuine node-migrations.

**Shipped:**
- **`EVENT-LEXICON.md`** (REFERENCE spec) — the canonical impulse vocabulary + the canonical+alias
  back-compat policy, so a new node/demo can't re-fork a name. Records every fleet impulse, the dead
  `cvhr_surge`, and the deferred items.
- **`integrator-app.js`** `genSynthetic` + **`integrator-dsp.js`** `adaptOxyDex` legacy-synthesis →
  emit canonical **`desat_event`** (was `spo2_desaturation`). The Integrator now surfaces ONE desat
  name for OxyDex whether it read a v2.0 stream or synthesized one. Gather sets unchanged (still accept
  `spo2_desaturation`/`desat` aliases) → fusion unbroken; committed historical fixtures keep fusing.
- **`tests/dex-tests.js`** — NEW group **"Event lexicon — canonical impulse names + back-compat
  aliases"** (9/9: synthesis emits canonical, a desat under EITHER name confirms apnea, source-mirrors);
  the corroborate-desat assertion updated to the canonical name; **`integrator-app.js` wired into both
  runners' source lists** (no more silently-skipped source-mirror).

**Findings recorded:** the bare-array fork was **OxyDex-specific** (§4); `cvhr_surge` is a **dead**
accept-type (no emitter); `hrv_drop`/`hrv_low` + `stress_peak`/`stress_high` are **node-scoped variants**
(no live cross-node consumer) — all enumerated for -II.

**Deferred → `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II-2026-06-29-BRIEF.md`:** CPAPDex emitter
`desat`→`desat_event`; the §3 PB cross-node fusion FEATURE; the `hrv_*`/`stress_*` unify question; the
dead-`cvhr_surge` drop; and the multi-record carrier-key inconsistency.
