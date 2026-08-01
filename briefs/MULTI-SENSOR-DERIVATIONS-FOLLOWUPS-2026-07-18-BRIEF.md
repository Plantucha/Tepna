<!--
  MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-18 · **Follows:** `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` (DONE) · **Related:** `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md` · `APNEA-TYPING-FUSION-2026-07-18-BRIEF.md` (DONE)

# Multi-sensor derivations — follow-ups: what executing four fusions surfaced

Spawned per `CLAUDE.md` §📌 after **§1.1 · §1.2 · §2.2 · §2.4** shipped (PRs #172, #178, #182, #186).
The features were the small part; most of the value was in defects and mis-scopes the work exposed.
Nothing here blocks what shipped.

## 1 · The recurring defect: fabricated absence in per-epoch series ⚠️ **the load-bearing one**
Three of the four fusions surfaced the SAME bug shape, and it predates this work (`EVENT-COUPLING` §2's
×0.72 artifact). A per-epoch series feeding a fusion must be **tri-state** (`true`/`false`/`null` =
sensor not recording) and nulls must leave the **denominator** — otherwise a coverage gap manufactures a
clinical finding:
- `actigraphy()` scored an epoch with **zero ACC samples** as `counts=0 → moving=false → immobile` — a
  recording gap fabricating *stillness*, which then inflated a motion-gated HRV confidence. **Fixed** (#182).
- Effort/posture series: "no chest-ACC" must read **UNTYPED**, never **CENTRAL** apnea. **Encoded + gated** (#172).

**Done here:** `AUDIT-PROMPT.md` bug class **#3** gained sub-class **3a** naming this variant explicitly
(it is nastier than the classic form — nothing looks null; the epoch returns a plausible measurement).
**Still owed:** an audit pass applying 3a to the series that predate it — `ppgdex-dsp` motion/SQI epochs,
`ecgdex-dsp` epoch series, `cpapdex` per-session lanes. Ask of each: *what does this field say when the
sensor was off?*

## 2 · PpgDex RIIV — §2.2's missing third leg (a real DSP defect, deliberately not worked around)
`fuseRespirationRate` fuses MotionDex chest-ACC + ECGDex RSA today. PpgDex should be the third
independent estimate, but `ppgdex-dsp` hardcodes `respRate: null` because **`PPGDSP.lombScargle` never
tracks the HF peak** — diagnosed in `TCH-REFERENCE-VALIDATION-2026-07-12` §F1 and still open.
The fuser is **n-agnostic** and null-safe (verified — adding a PpgDex record without the field leaves output byte-identical). **⚠️ CORRECTED 2026-07-18: "fix the DSP and PpgDex folds in with no Integrator change" is FALSE.** Executed trace (`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md` §1.6) found **three** links missing, not one: (i) `lombScargle` (`ppgdex-dsp.js:927`) accumulates band power and never retains the argmax — its return literal has no frequency-valued field; (ii) the export's `hrv.frequency` block (`ppgdex-dsp.js:2279`) has **no `respRate` key at any level**; (iii) the Integrator's `PulseDex|HRVDex|PpgDex` ingest branch (`integrator-dsp.js:395-500`) **never assigns `summary.respRateBrpm`**. Confirmed by execution: synthetic 135 Hz PPG with RSA planted at 0.25 Hz returns `respRate` null on all 3 epochs while hf = 5758/5729/5657 ms² — the modulation IS captured as power; only frequency extraction is absent. **✅ RESOLVED 2026-08-01 — and the correction itself needed correcting.** Links (i) and (ii) were real and are fixed: `lombScargle` now retains the HF argmax and the export publishes `hrv.frequency.respRate` + `respRateMethod` (plus per-epoch `respRate`), verified against a KNOWN answer — RSA planted at 0.25/0.20/0.30 Hz recovers 15.06/12.06/18.06 breaths-min, and three distinct plants give three distinct answers so a constant cannot pass. **Link (iii) was NOT missing.** `integrator-dsp` assigns `summary.respRateBrpm = _hf.respRate`; it simply had nothing to read, because (ii) meant the key never existed. So the ORIGINAL claim was closer to right than its correction: the fuser really is n-agnostic and PpgDex folded in with **no Integrator change** — what was false was only "the DSP fix" being one fix rather than two. Verified in the tree before building on it, not read off this line. So the DSP fix alone does **not** complete the third leg. That makes
this the single highest-leverage item here — it upgrades a 2-source method comparison into the rare
3-source one §2.2 was written for. Its own executable brief when taken up (a DSP change → gated,
fixtures re-verified).

## 3 · A gate that never drove the real ingest path
The §1.1 typing gate built Integrator records **by hand**, so it passed while MotionDex was **not
registered** in `NODE_COLORS`/`KNOWN_NODES` — the R2 guard was warning *"will load but be excluded from
fusion"* and nothing failed. §1.2 only caught it because it drove `normalizeFile` end-to-end.
**Rule:** a fusion gate must drive the node's **real ingest seam** (`normalizeFile`) at least once, not
just hand-built `recs`. Worth generalising into the TEST-AUDIT lineage: hand-built fixtures test the
function, not the wiring.

## 4 · Residual derivations
- **§2.1 cardiorespiratory/actigraphic sleep staging** — the last unexecuted Tier-1/2 item. All its inputs
  now exist (MotionDex `activitySeries` + HRV from ECGDex/PulseDex), so it is unblocked.
- **§2.2** is complete at **2 of 3 legs** (see §2 above), and the parent brief says so rather than
  claiming a 3-way fusion.

## 5 · Smaller things
- **`_norm` single-pass tag strip** in 7 `*-registry.js`: CodeQL flags it (`js/incomplete-multi-character-
  sanitization`) and it BLOCKED PR #162 — but only a NEW copy is flagged; the existing 7 are baselined and
  the looped fix is **provably behaviour-inert** (6561-input fuzz, zero difference — any `<` surviving the
  `/g` pass has no `>` after it). Inputs are hardcoded labels, never user input. **Decision (owner,
  2026-07-18): fix opportunistically** when a node is already being re-bundled; do NOT sweep the fleet for
  a proven no-op (7 re-bundles → every `manifestHash` moves → §👥.3 serialisation).
- **MotionDex render-coverage rig** + **position-frame calibration** are tracked in
  `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18` — not duplicated here.

## Done-when
Each item is executed or carries an explicit park reason. §1 (3a audit pass) and §2 (PpgDex RIIV) are the
two with real engineering behind them; §3 is a testing rule to propagate; §4 is the remaining agenda.
