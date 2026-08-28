<!--
  PAT-RESIDUAL-ATTRIBUTION-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-28 · **Spawned by:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (campaign boundary declared 2026-08-28) · **Interlocks:** `PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md`, `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md`

# What spends the last 20–40 ms — the one PAT question the current corpus cannot answer

> **Why this brief exists:** the PAT root-cause campaign answered its charter and then stopped at a
> boundary rather than past it. One term survived every elimination, and the experiment that would
> settle it **exists, is sound, and is not powered by the data we hold.** This brief records the
> question, the validated design, and the exact n it needs — so it is picked up when the corpus
> supports it and not re-derived from scratch.

## 1 · The state, by reference not by copy

The campaign's error budget and its full eliminated-candidates table live in
[`PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md`](PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md)
§6c. **Do not duplicate that table here** — a second copy is a second thing to keep true, and this
repo has already paid for divergent duplicates. In one line: no sensor-side term exceeds ~11 ms, the
acceptance window is the limit where it dominates, and after an out-of-sample window a residual of
**20–40 ms** remains, against a **~11 ms** measured sensor floor.

That residual is a **slow trend** — established on 8/8 nights, shuffle-controlled, with white noise,
respiratory oscillation, HR coupling and the **inter-device clock** all eliminated.

## 2 · The two surviving candidates

| candidate | what it would mean |
|---|---|
| **Slow physiological variation** — blood pressure, vasomotor tone, posture, sleep stage | The residual is **SIGNAL**: the quantity PAT exists to measure. The budget has no hole and the term should be reported, not removed. |
| **An instrumental effect the host axis cannot see** — sensor warming, contact/wear drift, coupling change | The residual is **ERROR**. The budget has a hole and a hardware or wear-protocol remedy applies. |

These are not near-neighbours: they point at opposite remedies, and one of them makes the term a
feature. **Recording the residual as either without evidence would be the campaign's worst possible
inversion**, which is why the campaign declined to choose.

## 3 · The design — validated as non-circular and non-confounded

**Two PPG sites against one ECG reference.** A systemic physiological trend moves **both** sites
together; a contact or wear artifact is **site-local**. So the correlation of the two sites' lag
trends discriminates the two candidates directly.

**Why the obvious alternatives fail** (each checked during the campaign, recorded so they are not
retried):

| alternative | why it fails |
|---|---|
| cross-device lag vs each device's internal intervals | **CIRCULAR** — `lag_n − lag_0 ≡ Σff − Σrr` is an algebraic identity, true whatever the cause. Asserted in `tools/pat-drift-attribution.mjs`'s selftest so it cannot be re-derived as a measurement. |
| per-LED comparison | **COMMON-MODE** — three LEDs share one housing, one skin contact and one clock, so both candidates move them together. |
| amplitude / DC-level covariance | **CONFOUNDED** — perfusion is itself physiological, so the predictor and one hypothesis are the same thing. |
| **two sites, one ECG** | **SOUND** — two sites share neither housing nor contact, and the clock cancels within each site's own lag series. |

## 4 · 🔴 Why the current corpus cannot power it

Measured on `/home/michal/tepna-smoketest/captures`, 42 nights:

- **The clean pair — two Verity units, both with real (non-drawn) axes — exists on TWO nights**:
  2026-07-25 and 2026-07-26.
- **The plentiful pair — Verity + O2Ring, on most nights — is CONFOUNDED.** The O2Ring's axis is
  **DRAWN** (`index × assumed rate`, ≥99 % of inter-sample deltas on one value; see
  `o2ring-timestamp-is-drawn` and the Clock Contract §🔒.7). A drawn axis **manufactures its own
  linear drift**, which is precisely the quantity under test. Using it would not measure the
  discriminator; it would measure the O2Ring's synthesised counter.

**n = 2 is not enough, and the campaign already set that precedent against itself.** The
clock-offset-versus-regime test was refused at **n = 11** because its 95 % CI on ρ spanned
`[−0.53, +0.67]` — both verdicts. Running a two-site test at n = 2 would be the same error with a
smaller sample, on a hypothesis the author would prefer to resolve. **The line holds in both
directions or it is not a line.**

## 5 · What it needs, and where that comes from

- **n ≈ 29 nights** carrying two *real-axis* PPG sites plus ECG — the figure the campaign derived for
  detecting ρ = 0.5 at 80 % power (ρ = 0.3 would need 85).
- **Source: the vigil box** — `vigil:/srv/tepna/captures`, the freshest nights, reachable over
  `ssh vigil` (see [`docs/CORPUS-LOCATIONS.md`](../docs/CORPUS-LOCATIONS.md); note
  `corpora-live-on-the-box`). **Whether vigil actually holds two-real-axis-site nights is UNVERIFIED**
  — that check is step 1 below, and this brief does not assume the answer.
- If vigil does not hold them either, the honest outcome is that **this question needs a capture
  protocol change** (deliberately wearing two Verity units at two sites) rather than more analysis.
  That is a request to the owner, not a task.

## 6 · Steps

1. **Verify the n exists before building anything.** Count nights on vigil with two non-drawn PPG
   sites + ECG. `quality.timingSource` / `hostAxis.drawn` decide "non-drawn" — never the filename.
2. **Pre-state the bands and the predicted signs** before computing, per the campaign's standing rule.
   State the power the actual n supports, and **refuse rather than report** if the CI cannot separate
   the two candidates.
3. Extend `tools/pat-drift-attribution.mjs` with a two-site arm (it already loads both legs and
   computes per-night lag slopes; the new part is the site-pair correlation).
4. Report the correlation with its CI, and label the outcome SIGNAL / ERROR / UNINFORMATIVE — the
   third being a legitimate result, not a failure.

## 7 · Done when

- [ ] Two-real-axis-site night count on vigil established, with the drawn-axis test applied per night.
- [ ] Either the discriminator is run at a power that can separate the candidates, or the shortfall is
      reported and the protocol change is put to the owner.
- [ ] The residual is labelled SIGNAL, ERROR, or UNINFORMATIVE — never left implied.
- [ ] `PAT-FORENSICS-WINDOW-ORACLE`'s §6c table updated with whichever cell this closes.

## 8 · What this brief must not become

⚠️ **Do not re-open the campaign's settled findings to make this one tractable.** The window
mis-specification, the fiducial bounds, the clock elimination and the regime table are landed and
evidenced. This brief owns **one** cell — the origin of the 20–40 ms — and nothing else.

⚠️ **Do not substitute a confounded proxy because the clean design is unavailable.** The O2Ring pair
is *right there* and it is wrong; that is exactly how a confounded result gets published as a clean
one. If the n does not exist, say so.
