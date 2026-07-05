<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Software Safety Classification — Tepna (IEC 62304 §4.3)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

> **Intended use (non-device).** Tepna is for personal self-quantification. It is **not a medical
> device; it does not diagnose, treat, cure, or prevent any condition** (`suite.manifest.json`
> `intendedUse`). This classification is an **alignment** exercise adopting IEC 62304's method
> voluntarily; it is **not** a regulatory determination and makes no conformance claim.

## Determination

**Class A** (no injury or damage to health is possible) — adopted as the working classification, on
the following reasoning.

IEC 62304 assigns a software safety class from the **severity of harm** that could result from a
software failure, *assuming* the software contributes to a hazardous situation. Tepna's outputs are
**retrospective, descriptive summaries** of a signal the user already recorded (overnight oxygen,
heart rate, HRV, glucose, CPAP therapy data). It:

- issues **no alarms, no real-time monitoring, no therapy control, and no diagnosis**;
- drives **no actuator** and feeds **no downstream device**;
- runs **100% locally** with no account and no network egress (enforced by `no-network.html`);
- surfaces every number with an **evidence badge** (measured → heuristic) and a standing non-device
  disclaimer, so the user is told the epistemic weight of each figure.

The realistic worst case of a computation error is that a self-quantifier is **misinformed** about a
past night and forms an inaccurate impression — not physical harm. That is the Class A profile.

## Hazard reasoning (informal)

Not a substitute for an ISO 14971 risk file (see the gap in `SOFTWARE-LIFECYCLE-PLAN.md §3`), but the
principal failure mode and its mitigations, recorded honestly:

| Failure mode | Effect | Mitigation |
|---|---|---|
| Wrong metric value (DSP bug) | User misinformed about a past night | Reproducibility gates (`verify-provenance.html`), equivalence/golden legs, evidence badges, the "measure-don't-guess" audit charter |
| Fabricated data (absence rendered as a value) | False reassurance/alarm | Anti-fabrication gates (null-not-now Clock Contract; zero-seed fabrication gate) |
| Over-trust of a low-evidence metric | User over-reads a heuristic | Evidence ladder on **every** surfaced number (coverage mandate, `CLAUDE.md` §🎫) |
| Misread timestamp (timezone) | Wrong night/ordering | The Clock Contract (floating wall-clock ms + `getUTC*`), gate-verified |

## Re-classification trigger

If Tepna ever gains a real-time alert, a therapy recommendation, a diagnostic claim, or a downstream
device integration, this classification is **void** and a full IEC 62304 + ISO 14971 assessment
(Class B/C) is required before release.
