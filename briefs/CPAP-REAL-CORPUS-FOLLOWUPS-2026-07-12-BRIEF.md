<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 (§1 · §2 executed; §3 · §4 already closed) · **Created:** 2026-07-12 · **Follows:** `CPAP-REAL-CORPUS-2026-07-11-BRIEF.md` (DONE 2026-07-12) · **Sibling:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`

# CPAP real corpus — follow-ups: two uncalibrated numbers, an unrun render lane, and a primitive nobody consumes yet

> **What this is.** `CPAP-REAL-CORPUS` is executed end-to-end (P1–P6, P9). This brief carries what
> executing it *surfaced and did not close*. Same scope rule as the parent, and it is not optional
> here either: **the corpus is a real person's therapy record and this repo is public.** Code facts
> and method facts only — no clinical values, no per-night indices, no therapy narrative.

---

## 1 · The `mode` thresholds ✅ **EXECUTED 2026-07-12 — and the premise was wrong**

> **Measured on all 182 real nights. The calibration this section asked for is IMPOSSIBLE, and finding
> that out changed the design.**
>
> **The distribution is UNIMODAL.** `pressureEnvIqr` is one continuous hump — median **1.33**, range
> 0.11–3.83, **no valley**. The bimodality this section predicted (a fixed-machine cluster near 0, an
> auto-titrating cluster above 1, dead-band in the empty space between) **does not exist**, for a
> reason that is obvious in hindsight: **the corpus contains no fixed-CPAP nights at all.** It is one
> machine in one mode. A boundary between two classes cannot be fitted to data containing only one of
> them — so any CPAP-vs-APAP cut is, on this data, **unfalsifiable**. The thresholds stay uncalibrated
> not through neglect but because the corpus cannot calibrate them.
>
> **And the real defect was the UNIT OF ANALYSIS, not the constants.** `mode` describes a device
> *setting*. A setting does not change from night to night — so a per-night estimator has no per-night
> signal to find, and can only measure nightly noise in a quantity that is constant by construction.
> The corpus says exactly this, with the same statistic judged two ways:
>
> | estimator | label flips across 182 nights |
> |---|---|
> | old bare-IQR cut (pre-P4) | **41** |
> | P4's per-night envelope + session stability guard | **7** |
> | **rolling 7-night median of the same envelope** | **0** |
>
> The device did not change 7 times. P4 was a real improvement (it stopped measuring EPR) but it was
> still the **wrong shape**, and no per-night guard could have rescued it — P4's guard pooled SESSIONS
> *within* a night when the quantity is stable *across* nights. It guarded the wrong axis.
>
> **Executed:** the per-night `mode` label is **RETIRED** (`metrics.mode` is now always `null`; the
> field is kept, so the export contract does not break). The CPAP-vs-APAP call now lives ONLY in
> `buildLongitudinal()` (`mode` / `modeEnvIqr` / `modeNights`), needs **≥7 nights**, and is flip-free on
> the corpus (**APAP @ 1.33 cmH₂O over 180 nights, 0 flips**). A single night reports `pressureEnvIqr`
> — a *measurement* — and names no device setting. The pressure card no longer carries a mode chip.
>
> **Still true, and still labelled as such:** the cut points remain unvalidated. Treat the longitudinal
> label as a *stable inference from the pressure envelope*, not a device readout. If a fixed-CPAP
> corpus ever appears, fit the cut to the valley between the two modes — that is the only honest way.

## 1 (as proposed) — the premise, now refuted

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

## 2 · `event-coupling.js` ✅ **EXECUTED 2026-07-12 — and §M1's headline coupling is RETRACTED**

> **`tools/cpap-oxy-couple.mjs` now IMPORTS the primitive** instead of carrying its own copy (its
> prototype is deleted, so the tool can no longer drift from the gated module). That made it the
> primitive's first consumer — and re-running it re-derived §M1's numbers, which is what this section
> asked for.
>
> **The re-derivation kills §M1's positive finding.** On 44 paired CPAP∩O2Ring nights, with the null
> now WRAPPING circularly:
>
> | event class | n | lift, 0–30 s → 0–120 s |
> |---|---|---|
> | central | 733 | **×0.5 – 0.7** |
> | obstructive | 58 | **×0.7 – 1.1** |
> | hypopnea | 247 | **×0.6 – 1.1** |
>
> **Nothing couples above chance.** §M1 reported *"a rare class (n=39) showed ×3.3–10"* — that was an
> artifact of the **non-wrapping null**, which let surrogates fall off the end of a night where no
> desat can match them, deflating `chance` and therefore inflating `lift`. Exactly the direction the
> bug was predicted to bias. **§M1's ×3.3–10 is RETRACTED.** Its two *negative* findings survive
> unchanged (dominant class at chance; longest-duration bucket at ×0.0).
>
> **This is a well-powered null, not a saturation artifact** — `maxLift` is ×14–24 across these
> windows, so a coupling of up to ×14 *could* have been seen and was not. That is precisely the
> distinction the `saturated`/`maxLift` machinery was built to make, and it earns its keep here.
>
>
> ### ⚠️ CORRECTION 2026-07-12 (later the same day) — the numbers above were STILL wrong
>
> The anomaly flagged here (sub-chance lift, a ×0.0 longest bucket) was **not physiology. It was two
> more defects in my own primitive**, and I chased a clock-offset hypothesis before finding them.
>
> **(a) No coverage model — "an absent reading is not a miss".** The O2Ring records for part of the
> night, not all of it. **30% of apneas happened while the oximeter was not recording**, and the
> primitive scored every one of them as a MISS. Worse, it BIASES: an unobserved event is a forced miss
> at shift 0, but the circular shuffle can carry it back INTO the recorded span where it CAN hit — so
> chance rises above observed and lift lands **below 1**. That is manufactured *anti*-coupling, and it
> is exactly the ×0.5–0.7 reported above. The suite already holds this principle one level down
> (DEEP-AUDIT §17–21: *an absent reading is not a score of zero*); this was the same error one level up.
>
> **(b) No power floor.** The ×0.0 was never a finding: of those 48 long apneas, **32 were unobserved**,
> and across the 16 actually watched **chance alone predicts 0.9 hits** — so zero is a ~41% outcome.
>
> **Corrected numbers** (wrapping null + coverage + power), *n = events the oximeter was observing*:
>
> | class | n (observed) | lift, 0–30 s → 0–120 s |
> |---|---|---|
> | central | 527 | ×0.71 – 0.98 (×0.97–0.98 on the well-powered windows) |
> | obstructive | 25 | ×1.11 – 1.52 — **LOW-N**, not a finding |
> | hypopnea | 191 | ×0.82 – 1.33 |
>
> **The CONCLUSION is unchanged — no event class couples above chance.** But every magnitude in the
> table above it was wrong, and the ×0.0 "provably no signal" is **retracted**. `event-coupling.js` now
> takes `coverage` and reports `expectedHits`/`underpowered`, so neither error can recur silently.

## 2 (as proposed)

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

## 3 · §M5's disease on a USER-FACING surface — the demo ✅ **FIXED 2026-07-12**

> Running the render lane turned this up, and it is the sharpest confirmation of §M5 yet.
>
> **`CPAPDex`'s demo fetched ten GITIGNORED real recordings.** `DEMO_FILES` listed real AirSense
> `.edf` files, which are personal data and therefore not in the repo — so on **any fresh clone every
> fetch 404s** and the demo dies with *"Demo data unavailable in this build."* The button is there, the
> click throws nothing, and nothing happens. **The shipped demo had never worked for anyone but the
> maintainer.**
>
> §M5 found this disease in the *equivalence gate* (every node's input was a real recording → CI never
> ran the diff). This is the same root cause on a **user-facing feature**. The cure is the same one §P2
> already built: the **committed synthetic EDF set** carries no personal data, so it ships. The demo now
> points at it — 7/13 → **13/13**, verified on a tree with no personal data present.
>
> **Why nothing caught it, which is the real lesson.** The headless suite structurally cannot (a demo is
> a browser surface). The render lane *does* have a CPAPDex rig asserting exactly this — but **its
> assertions were not running**. `GATE-INTEGRITY-AND-DEVLOOP` ("stop the gate shrinking in silence") made
> them run, and CPAPDex went straight to 7/13 **with a byte-identical bundle**. A gate that silently
> shrinks is worse than no gate: it reports success for work it never did.
>
> **Rule:** a demo must not depend on anything gitignored. Worth a gate of its own — assert every
> `DEMO_FILES` entry is a tracked path (see §5).

## 4 · The browser render-coverage lane ✅ **RUN 2026-07-12**

Every headless gate is green (`run-tests.mjs` 2132/0, `build.mjs --check` clean, GATE A/B clean,
`tsc` clean). But **`Dex-Test-Suite.html?full` has not been driven**, and P4 changed a *rendered* surface:

- the `mode` chip now reads **`unknown`** on an indeterminate night (it previously always said CPAP or APAP);
- **`pressureEnvIqr` is a NEW card** on the CPAPDex pressure section, with a new registry entry + badge.

The headless floor cannot see either — that is precisely what the browser-only render lane is for
(CLAUDE.md §🧪: a bare open is *the floor, NOT a pass*).

> **Done.** `Dex-Test-Suite.html?full` on a **clean tree** (no personal data): **all green — 2441 passed,
> 0 failing, 11 render-coverage groups, `bootSkips: []`.** Both of P4's new rendered surfaces are covered
> (the `mode` chip reading `unknown`, the new `pressureEnvIqr` card).
>
> ⚠️ **`origin/main` @ v1.8.0 is RED on this lane** (CPAPDex 7/13, the demo defect above) — it shipped a
> release with a red render lane because only the headless floor was run. That is the §M5 lesson landing
> a third time: **"headless green" is the floor, not a pass** (CLAUDE.md §🧪).

---

## 5 · P7 and P8 were never in the parent's "Done when"

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

## 6 · Smaller things surfaced in passing

- ✅ **The fleet-wide `outputHash` gap is CLOSED (2026-07-12).** `build.mjs` re-stamps a fixture's
  `manifestHash` but never recomputes its `outputHash`, so a code change can leave the ledger asserting
  "reproducible under this code" while the committed bytes say otherwise — and GATE B, being static,
  cannot see it. Auditing that turned up something worse: **3 of 21 code-gated fixtures had no dynamic
  leg at all** (`OxyDex_..._0439`, `cpapdex-2026-06-12`, `cpapdex-2026-06-16`) — the repo said so in
  *prose* and nothing enforced it. All three now have legs (and all three reproduce byte-identical), and
  a new gate makes the class impossible: **every code-gated fixture must be re-run by something, or be
  demoted to `historical`.** Two more defects fell out of the same audit: one absent recording was
  silently deleting **nine** equivalence legs (a shared `try{}` in the browser loader — the "gate shrinks
  in silence" pattern again), and **`DEX_UPLOADS` was serving the answer key** (it redirected the tracked
  *fixture* files, not just the recordings, so a stale checkout could produce a false PASS).
- **`tools/regen-cpap-goldens.mjs` is still CPAP-only.** It exists because `build.mjs` re-stamps a
  fixture's `manifestHash` but does **not** recompute its `outputHash` — so a content-moving code change
  needs the fixtures regenerated by re-running the modules, or the ledger asserts a reproducibility that
  is false. That gap is **fleet-wide, not CPAP-specific**; other nodes regenerate fixtures ad hoc.
  Consider generalizing it (`--node <Name>`), or at least documenting the two-step (regen → build) in
  CLAUDE.md §🔏's re-bundle checklist.
- **No gate pins a demo to committed inputs.** §3's bug was a *user-facing feature* silently depending on
  gitignored data, and nothing asserts it cannot recur — in CPAPDex or any other node. A cheap headless
  gate: parse each app's `DEMO_FILES`/demo fetch list and assert every path is git-tracked.
- **`how-to-collect/cpap-edf.md` predates the adapter** and does not mention `resmed-edf`. 7 of 8 other
  adapters have a matching `how-to-collect/<adapter-id>.md`; nothing gates it.
- **`pressureRange` is now a spread statistic with no consumer story.** Its `cite` no longer claims to
  call the mode (correct), but it is still surfaced with `goodDirection:'down'`, which is meaningless for
  a machine that is *supposed* to vary its pressure. The registry vocabulary has only `up`/`down` — a
  `neutral` direction would be honest for descriptive metrics like this, but adding a third value is a
  fleet-wide vocabulary change and was deliberately **not** taken here.
