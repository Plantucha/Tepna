<!--
  PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-10 · **Consolidated-into:** `PAT-COMPENDIUM-2026-08-10-BRIEF.md` · **Created:** 2026-08-04 · **Corrects:** `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` §3j/§4.2, `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` §"arm band" · **Follows:** `PAT-PROXIMAL-DISTAL-PAIR-2026-08-04-BRIEF.md`

# The Verity has ALWAYS been on the left ankle. Every "arm/wrist" plausibility argument in the PAT family is against the wrong band.

**Wearer-confirmed 2026-08-04, and constant for the entire corpus:**

| device | site |
|---|---|
| Polar Verity Sense | **LEFT ANKLE** |
| Wellue O2Ring | **RIGHT INDEX FINGER** |
| Polar H10 | chest |

No brief records this. Several assume the Verity is an armband — reasonably, since that is how Polar
sells it — and then use an **arm/wrist PAT band as a plausibility test**. That test is against the wrong
anatomy, and it has been used in both directions: to reject results as too long, and to accept results
as landing in the expected range.

## 1 · What is affected

| claim | where | under the real placement |
|---|---|---|
| *"arm→finger cancels PEP by construction … 92 ms"* | `PAT-VERDICT-CONSOLIDATED` §3j | the pair is **ankle→finger**. PEP still cancels (both are peripheral PPG), so the 92 ms stands as a number — but it is not an arm measurement |
| *"Everything here is arm/wrist and finger — peripheral, with a **short transit**"* | ibid. §4.2 | chest→**ankle** is the LONGEST peripheral path available on this hardware. The premise that a long path was never tried is wrong |
| *"a median lag of 406–498 ms is not physiological for an arm site"* | `PAT-NO-VALID-ANCHOR` | for chest→ankle, 406–498 ms is **not implausible**. A result was rejected on an anatomy it did not have |
| *"the published arm/wrist band (200–250 ms). That the level lands there is an independent check"* | ibid. | for an ankle site, landing in the **arm** band is not a check that passes — it is one that should raise a question |
| *"the rest cluster near 90 ms, **below** the arm band"* | ibid. | 90 ms is far too short for chest→ankle under any model, so the anomaly is larger than recorded, not smaller |

**This brief does not re-derive any of those results.** It corrects the premise they were judged against.
Whether a rejected result becomes admissible is a re-analysis, and it is owed.

## 2 · Why it matters beyond bookkeeping

PAT scales with path length: a longer arterial path gives a larger transit for the same beat-to-beat
noise, so the signal-to-scatter ratio improves. §4.2 reasoned correctly about that and concluded the
corpus lacked a long path. **The corpus has had one all along** — every ECG→Verity night is chest→ankle.

The measured consequence is in `PAT-PROXIMAL-DISTAL-PAIR` §2b: finger↔ankle scatter is **67 ms**
enumerated over 29 pairs against §3j's **92 ms**, a ~27 % improvement in the predicted direction. That
is the site effect §4.2 hoped for, and it is real — it is simply not large enough to clear the 60 ms bar.

## 3 · The general lesson

**Sensor placement is a measurement input and was never recorded.** It is not in the filenames, not in
the exports, not in `config.yaml`, and not in any brief. Four briefs inferred it from the product name.
The corpus cannot answer it; only the wearer can.

The one thing that *would* have caught it is already in use and did: **the SIGN of the lag**. Finger→ankle
must be positive, and `PAT-PROXIMAL-DISTAL-PAIR` §1 flagged `2026-07-18`'s −121 ms as anatomically
impossible before the placement was confirmed. A sign test needs no arm/ankle assumption — it needs only
which sensor is proximal.

## 4 · Done when

- [ ] `config.yaml` (or the capture-host device record) carries a `site:` field per device, so placement
      reaches the exports and no future brief has to infer it.
- [ ] `PAT-NO-VALID-ANCHOR`'s rejected 406–498 ms results are re-judged against an ankle band rather than
      an arm one. They may or may not survive; the point is that they were never tested against the right
      anatomy.
- [ ] `PAT-VERDICT-CONSOLIDATED` §4.2 is amended — the long-path route was not untried, it was unlabelled,
      and `PAT-PROXIMAL-DISTAL-PAIR` §2b measures it.
