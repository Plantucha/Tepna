<!--
  OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-FOLLOWUPS-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-03 · **Created:** 2026-07-03 · **Parent:** OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-2026-07-03-BRIEF (DONE)

# OxyDex warm-up / SpO₂-nadir follow-ups — residue from the 44-night corpus scan

The parent fix (bounded `cleanArtifactHR` + `trimSensorWarmup` frozen-placeholder trim) is DONE and
gate-green. Running the real code over **all 44 raw O2Ring nights** surfaced two things that are
genuinely OUT of the parent's *frozen-placeholder* scope and want a deliberate decision — NOT silently
folded in, because both risk deleting real physiology. Neither is a regression from the parent (the
parent strictly improved every affected night); they are pre-existing behaviors the scan made visible.

## Execution status — 2026-07-03 (§1 + §2 IMPLEMENTED & validated; release bookkeeping pending)
**Decision taken:** one honest-nadir gate for BOTH §1 and §2, reusing the EXISTING tested machinery (no new
tuning). New `computeGatedNadir(rows, desat, rawMin)` in `oxydex-dsp.js` recomputes the headline nadir
excluding (a) samples inside a **self-gated ARTIFACT desaturation** (`desat.eventsAll[].artifact` — the SAME
SELFGATE verdict the ODI already excludes, §2) and (b) an **opening perfusion-settling ramp** (SpO₂ starts
≤`NADIR_RAMP_START_MAX`=88 and climbs to ≥`NADIR_RAMP_RECOVER`=90 within `NADIR_RAMP_MAX_SEC`=120, starting
at/near its own min, §1). Wired into `processNight` after the desat profile; **overwrites `stats.minSpo2`**
(so `SPO2_CRITICAL_DIP` + the impression + the minSpo2 card all become honest) and preserves the raw absolute
min as `stats.minSpo2Raw` **only when the gate fires** (conditional → byte-identical export otherwise).
Info flag `SPO2_NADIR_GATED(raw→gated)`. `computeGatedNadir` exposed on the namespace + bare-globals.
NOT deletion — rows/ODI/every other metric are untouched; only the nadir STATISTIC skips the excluded samples.

**Validated over all 44 raw O2Ring nights (real `computeNight`):**
- §2 cliffs gated: `20260613` **61→85**, `20260623` 75→76. §1 opening ramp: `20260615` **81→84**.
- 8/44 nights' `minSpo2` moved — the other 5 (e.g. `20260514` 79→90) simply make `minSpo2` **consistent with
  the ODI** (those desats were already ODI-excluded as self-gated artifacts). Real sustained desats (80–88)
  are KEPT (gate does not fire).
- **Both committed fixtures unchanged** (`20260612` 86, `20260624` 90 — gate does not fire) → EXPORT-INERT,
  manifestHash-only re-record expected.
- **§3:** `SPO2_CRITICAL_DIP` 24→20 nights — the removed 4 were purely artifactual; the remaining fire on
  genuine sustained lows, so the ≤88 threshold + odi4 framing are UNCHANGED (no code change for §3).
- Regression group added to `tests/dex-tests.js` ('OxyDex nadir honesty — gated minSpo2'); `OxyDex.html`
  re-bundled (535 KB).

**Remaining (bookkeeping only — source complete & self-consistent):** read the new OxyDex `manifestHash`
off `verify-provenance.html` (reconcile panel) → update `BUILD-MANIFEST.json` GATE A + BOTH fixture records'
`manifestHash` in `FIXTURE-PROVENANCE.json` (manifestHash ONLY, outputHash/inputHashes unchanged; old
committed = `91196f73460c`) → run `verify-provenance` (GATE A/B) + `Dex-Test-Suite.html?full` (equiv.oxydex
byte-identical + new group + render-coverage) → flip this header to DONE → delete `scan-nadir.html` + `_diag/nights`.

---

## §1 (MED) — Gradual-ramp warm-ups are NOT caught (by design), and feed a false critical nadir
`trimSensorWarmup` trims only a **byte-frozen** (SpO2,HR) run ended by a lock-on step. Some nights
warm up as a **smooth ramp** instead:

```
20260615:  21:57:11  81/50   →  81/49 → 81/48 (HR drifts, so NOT frozen) → … → 87/53   (~20 s climb)
```

The run isn't frozen (HR changes every few samples), so it is correctly left by the conservative
frozen detector — but the settling **81 %** then becomes the night's `minSpo2` and fires
`SPO2_CRITICAL_DIP`, almost certainly a **perfusion-settling artifact, not a real desaturation**.
Several other nights open low-and-climbing (`79`/`80`/`81`/`85`).

**Decision needed (do NOT auto-extend — high false-positive risk):** should the warm-up detector also
recognize a *monotonic low-start ramp* — SpO2 starts ≤ ~85, climbs **monotonically** to ≥ ~90 within
≤ ~60 s, motion low — as a settling artifact? A real sleep-onset desat *drops then recovers* (it does
not start pinned low from sample 1), which is a usable discriminator. **Recommended (option b):** do
NOT trim/delete these samples; instead **flag** the opening ramp low-confidence and **exclude only its
minimum from `minSpo2`/`SPO2_CRITICAL_DIP`** (keep the samples in the trace). Trimming a ramp is far
riskier than trimming a frozen block. Needs a corpus pass to pick the ramp thresholds without eating a
real early desat.

## §2 (MED) — Mid-night extreme-low SpO₂ artifacts survive into `minSpo2` / the critical-dip flag
Distinct from warm-up: several nights carry a physiologically-implausible **mid-recording** nadir that
is almost certainly a motion/perfusion dropout, not a true desat — e.g. `20260613` **minSpo2 61**,
`20260623` **75**, plus a cluster of `79–85`. The desat **self-gate** (`selfGateDesat`) already
excludes artifact desaturations from **ODI**, but the headline **`minSpo2`** and the
**`SPO2_CRITICAL_DIP`** flag still read the **raw absolute minimum**, so one bad second can donate a
scary nadir. (`SPO2_CRITICAL_DIP` fired on ~half the corpus.)

**Decision needed:** should `minSpo2` / `SPO2_CRITICAL_DIP` (and the "nadir SpO₂ N%" impression) use an
**artifact-gated / kinetics-gated nadir** (e.g. the self-gate's accepted-desat minimum, or a robust
low-percentile like the already-computed `spo2P5`) instead of the raw `Math.min`? Keep the raw min
available as a separate "raw nadir (may include artifact)" field for transparency. This is the same
honesty principle as the parent fix (don't let one bad sample define the night).

## §3 (LOW) — Review `SPO2_CRITICAL_DIP` trigger rate
Downstream of §1+§2: with artifact-prone minima feeding a ≤88 threshold, the flag over-fires. Once
§1/§2 land (gated nadir), re-check the trigger rate across the corpus and confirm the threshold still
matches the odi4 registry framing. No code change until §1/§2 decide the nadir source.

## Notes
- The parent's reported night (`20260702`) still fires `SPO2_CRITICAL_DIP` at the **real 87 %**
  (post-trim) — that is **legitimate** (≤88), not a false positive; listed here only to confirm 87 is a
  genuine reading, which the row-level scan confirmed (the 84 was the trimmed placeholder).
- Any change here is DSP-behavior → same gate ritual as the parent (re-bundle OxyDex, GATE A + the two
  fixtures' GATE-B/equiv, `Dex-Test-Suite.html?full`). §1/§2 WILL move `minSpo2` on affected nights, so
  expect the two committed fixtures to be re-verified (they are clean nights — likely still inert — but
  confirm via `env.equiv.oxydex`).
