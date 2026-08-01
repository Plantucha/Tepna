<!--
  DESAT-ONSET-FIDUCIAL-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Found while executing:** `OXYDEX-SPO2-SERIES-2026-07-31-BRIEF.md` · **Affects:** `oxydex-dsp.js` `desat_event.meta` (additive)

# A desaturation has two instants and the export carried one

`desat_event.tMs` is the **nadir**. That is right for scoring — the nadir is the event's severity — and
**wrong for timing**: a desaturation begins when saturation starts falling and bottoms out a
desaturation-duration later, so anything correlating desat against another signal silently measures the
coupling **plus that duration**.

`startTMs` and `endTMs` were already computed and correctly stamped from the parsed rows
(`_stampEvent`), then **discarded at the export boundary** — the same loss, at the same boundary, as the
SpO₂ series itself. Both are now carried on `meta` as `onsetTMs` / `endTMs`. `tMs` still means the
nadir; the contract does not move.

Verified on the corpus: **496 desat events across 36 nights, 100 % carrying `onsetTMs`.**

## What it fixes, and what it does not

**Fixes the fiducial.** Paired on the nights where both resolve, transit measured from the nadir is
**19 s longer** than from the onset — and that 19 s is the desaturation's own duration, not physiology.
Anyone timing against `desat_event` was carrying it.

**Does NOT fix yield.** Still **2 nights of 36**, from either fiducial. `desat_event` is sparse for an
unrelated reason: it is artifact-gated and thresholded to the **clinical ODI definition**, leaving 7–15
events a night. A different fiducial on the same sparse channel is still a sparse channel.

## Which is the real lesson

Yield comes from the **SpO₂ series** (10 nights, `OXYDEX-SPO2-SERIES`), not from this. And the reason is
worth stating, because it justifies that decision better than the size argument did:

> The clinical desaturation definition and a timing fiducial are **not the same question**. ODI needs a
> defensible ≥3–4 % drop, artifact-gated; a timing measurement needs *many* well-localised edges and can
> accept shallower ones. A node that exports only its own clinical events forces every consumer to
> inherit a definition chosen for a different purpose. Exporting the **series** lets the consumer pick.

Both changes are therefore complementary and neither is sufficient: the series supplies the density, this
supplies the correct instant. They are **not yet combined** — the 10-night SpO₂ transit used an ad-hoc
onset rule (≥3 % within 30 s) written in an analysis script, which is not gated and not swept.

## Fixture impact: none, again

**No committed OxyDex fixture carries a `desat_event` at all** — the synthetic golden has zero, and the
two real ones are input-absent. So nothing moved, no gate reddened, and the change would have shipped
ungated on a suite that stayed green without exercising it. Third time today. The 7 assertions here are
the only thing defending it, and they include that an unstamped onset stays `null` rather than being
derived from the index — the uniform-stretch fallback drifts by minutes on a lossy night, which is the
failure the nadir stamp was itself introduced to fix.

That the desat→ganglior path has **no fixture coverage whatsoever** is a finding in its own right.

## Done when

- [x] `onsetTMs` / `endTMs` carried on `desat_event.meta`; `tMs` still the nadir.
- [x] Gated (7 assertions), including the null-not-derived rule.
- [x] Verified on the corpus (496/496).
- [x] The nadir-vs-onset difference measured (19 s) rather than assumed.
- [ ] A gated timing-fiducial onset detector over `timeseries.spo2`, so the 10-night result stops
      resting on an ad-hoc script rule.
- [ ] A fixture that actually contains a `desat_event`, so this path is defended by something other
      than a hand-written unit test.
