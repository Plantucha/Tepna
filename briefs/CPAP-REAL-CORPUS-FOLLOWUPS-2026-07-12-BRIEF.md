<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Follows:** `CPAP-REAL-CORPUS-2026-07-11-BRIEF.md` (DONE 2026-07-12) · **Sibling:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`

# CPAP real corpus — follow-ups: two uncalibrated numbers, an unrun render lane, and a primitive nobody consumes yet

> **What this is.** `CPAP-REAL-CORPUS` is executed end-to-end (P1–P6, P9). This brief carries what
> executing it *surfaced and did not close*. Same scope rule as the parent, and it is not optional
> here either: **the corpus is a real person's therapy record and this repo is public.** Code facts
> and method facts only — no clinical values, no per-night indices, no therapy narrative.

---

## 1 · The `mode` thresholds are set from physiology, not fitted to the corpus ⚠️ **the load-bearing one**

P4 retired the bare-IQR `mode` cut and replaced it with an EPR-immune, minutes-scale pressure envelope
plus a dead-band. The *estimator* is now right — it measures auto-titration rather than the EPR setting.
But its **two cut points are not calibrated**:

```js
var MODE_CPAP_MAX = 0.5;   // envelope IQR ≤ this ⇒ fixed
var MODE_APAP_MIN = 1.0;   // envelope IQR ≥ this ⇒ auto-titrating
```

They were chosen from physiology (a fixed machine's minute-scale envelope is *flat*; an auto-titrating
one wanders by cmH₂O) and they agree with every fixture available in-repo — real nights **1.2** and
**2.2**, the synthetic EDF **1.08**, a fixed machine **~0**. But the ~180-night corpus that diagnosed
§F2 **is not in this repo**, so nothing has been *fitted* to it.

The dead-band makes the failure mode safe (an unseparable night reads `null`, never a wrong device
setting), so this is not a correctness bug. It is an **unmeasured** one, and it is the reason `1.08` is
uncomfortably close to `1.0`.

**Do:** run the corpus through `tools/cpap-corpus.mjs` and report the **distribution of
`pressureEnvIqr`** across the ~180 nights. The claim to test is that it is **bimodal** — a fixed-machine
cluster near 0 and an auto-titrating cluster well above 1 — with the dead-band sitting in the *empty
space between them*, which is exactly what the old raw-IQR cut failed to do. Then:

- set the two cuts from the observed valley, not from taste;
- report **how many nights land `null`** (the honest cost of refusing to guess — if it is large, the
  window/percentile need revisiting, not the cuts);
- confirm the **57 flips are gone**, and that A4's two dated device-setting step-changes are *not*
  smoothed away by the 5-min window (they are the only labelled ground truth we have — see §4).

**Done when:** the two constants carry a cited, corpus-measured justification and a flip count.

---

## 2 · `event-coupling.js` has no consumer

P5 shipped the shuffled-null coupling primitive with 22 self-test + 21 contract assertions, and it is
deliberately **not co-loaded into any bundle** — no app uses it, and wiring it into `dex-coload.js` would
re-bundle all 8 apps to carry inert code (the `BADGE_CSS` economics). So it is gated but **dormant**.

It exists to answer the Integrator's "is it real or coincidence?" question. Until a node calls it, that
question is still being answered by raw co-occurrence somewhere.

**Do:** land the first consumer, which also settles where it rides. The parent brief's **P7** is the
natural one — apnea → HR (CVHR) and apnea → motion-arousal coupling on the 17 quad-modal nights (A3),
which independently tests M3's re-labelling alternative. When a node consumes it, it joins that node's
bundle (and `dex-coload.js`) on that pass.

**Also:** §M1's *conclusions* survive the primitive's three fixes, but its **magnitudes were computed
with the non-wrapping null** and should be **re-derived** through `EventCoupling.coupling()` before any
of them is published. (A non-wrapping shift deflates chance and therefore *inflates* lift — the reported
×3.3–10 for the rare class is an over-estimate of unknown size; the ×0.6–1.0 chance-level call for the
dominant class is directionally safe.)

---

## 3 · The browser render-coverage lane has not been run since P4 ⚠️

Every headless gate is green (`run-tests.mjs` 2132/0, `build.mjs --check` clean, GATE A/B clean,
`tsc` clean). But **`Dex-Test-Suite.html?full` has not been driven**, and P4 changed a *rendered* surface:

- the `mode` chip now reads **`unknown`** on an indeterminate night (it previously always said CPAP or APAP);
- **`pressureEnvIqr` is a NEW card** on the CPAPDex pressure section, with a new registry entry + badge.

The headless floor cannot see either — that is precisely what the browser-only render lane is for
(CLAUDE.md §🧪: a bare open is *the floor, NOT a pass*).

**Do:** open `Dex-Test-Suite.html?full`, wait for the group count to settle, confirm the pill is all-green
and `sameOriginStatus().bootSkips` is `[]`. **Before release.**

---

## 4 · P7 and P8 were never in the parent's "Done when"

The parent listed them as proposals but never gated them, so they are still open — and both are now
*cheaper* than when they were written, because P5 shipped the primitive they depend on:

- **P7 — apnea → CVHR / motion-arousal coupling on A3 (quad-modal, 17 nights), via `event-coupling.js`.**
  Independently tests M3's re-labelling alternative. This is also §2's first consumer.
- **P8 — A4's two dated device-setting step-changes as ground truth for `CPAPCross` change detection.**
  `CPAPCross` trend/change detection today only ever runs on synthetic nights with `sd: 0` and a
  `'stable'` label — i.e. it has **never been shown to detect a change at all**. A4 is a labelled
  change-point dataset sitting unused, and it doubles as the §1 check that the 5-min window does not
  smooth a real step away.

---

## 5 · Smaller things surfaced in passing

- **`tools/regen-cpap-goldens.mjs` is new and CPAP-only.** It exists because `build.mjs` re-stamps a
  fixture's `manifestHash` but does **not** recompute its `outputHash` — so a content-moving code change
  needs the fixtures regenerated by re-running the modules, or the ledger asserts a reproducibility that
  is false. That gap is **fleet-wide, not CPAP-specific**; other nodes regenerate fixtures ad hoc.
  Consider generalizing it (`--node <Name>`), or at least documenting the two-step (regen → build) in
  CLAUDE.md §🔏's re-bundle checklist.
- **`how-to-collect/cpap-edf.md` predates the adapter** and does not mention `resmed-edf`. 7 of 8 other
  adapters have a matching `how-to-collect/<adapter-id>.md`; nothing gates it.
- **`pressureRange` is now a spread statistic with no consumer story.** Its `cite` no longer claims to
  call the mode (correct), but it is still surfaced with `goodDirection:'down'`, which is meaningless for
  a machine that is *supposed* to vary its pressure. The registry vocabulary has only `up`/`down` — a
  `neutral` direction would be honest for descriptive metrics like this, but adding a third value is a
  fleet-wide vocabulary change and was deliberately **not** taken here.
