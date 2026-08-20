<!--
  JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-II-2026-08-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-20 · **Follows:** `JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md` (DONE — 2026-08-20) · **Parent chain:** `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md` · **Affects:** the per-block scatter ENDPOINT — investigation only, no code change proposed

# The covariate question was answered. The endpoint it was measured against is now in doubt.

The parent asked *what distinguishes a lockable night from an un-lockable one* and got a clean
negative: sixteen covariates on 54 nights, two block lengths, Holm-corrected, **none separates**. That
is recorded and closed.

Executing it surfaced two things that are **not** about covariates, and both bear on whether the
question was well-posed. Neither is a defect in the parent; both are reasons its negative should not
be the last word.

## 1 · The endpoint may be measuring capture provenance rather than lockability

The one covariate that moved is not a property of the night's signal at all. It is **how the night was
captured**, and its sign is backwards from the naive expectation:

| | box (`device+host`) | phone (`device` only) |
|---|---|---|
| n | 29 | 25 |
| scatter median, 900 s | **161 ms** | 93 ms |
| scatter median, 300 s | **125 ms** | 97 ms |

A night carrying a genuinely independent host clock scores **worse**. `CLAUDE.md` §7 predicts exactly
that: a phone-captured recording **has no second clock** — its host column is the device stamp rounded,
*"the absence of a measurement wearing the shape of one"*, with the two capture families separated by
residual spread (box 101.89–5124 ms, phone 0.13–1.00 ms, nothing in between). Two series that agree
because **one was derived from the other** produce a tight per-block offset, and that tightness is not
a lock.

**If that reading holds, the parent's population split is contaminated at its root.** "Lockable" would
partly mean "phone-captured", and the whole covariate exercise would have been regressing against a
label that encodes capture mode. It would also explain the parent's most surprising result — that the
upper population *did not reproduce at all* (50 of 54 nights under the 450 ms bar, against §1's
expected "about half" at 700–950 ms): a corpus that is 25/54 phone nights cannot show a large
divergence on those nights, because there is only one clock in them.

🔴 **NOT ESTABLISHED, and the parent deliberately did not conclude it.** Holm-adjusted, `hostClockPresent`
clears nothing (p 0.104 at 900 s, 0.904 at 300 s), and the cross-tab is nothing at all: **3 of 29 box
nights un-lockable against 1 of 25 phone**. A mechanism with a matching sign and a plausible story is
the weakest evidence this repo accepts, and it is being carried here rather than asserted there
precisely so it does not become a fact by repetition.

### 1.1 · The test that would settle it costs nothing new

`hostAxis` already publishes **`spreadMs`** and **`independent`**, and §7 defines the discriminator as
spread rather than slope, with a measured bimodal gap. So the question is answerable from data already
on disk:

- [ ] Recompute per-block scatter on the **box nights alone** (n = 29). If the two populations appear
      there — and only there — the parent's split was a capture-mode artefact, and the covariate
      question should be re-asked on that subset.
- [ ] Cross-check `timingSource` against `hostAxis.independent`/`spreadMs` on the same nights. Two
      independent provenance signals agreeing is worth more than either alone; disagreeing is a defect
      report about one of them.
- [ ] State the answer with its n. 29 nights and 3 un-lockable is still thin, and a second negative at
      that power says as little as the first.

## 2 · A zero-inflated variable summarised centrally reads as "no signal"

Posture is one of the parent's four **named** candidates. It was first summarised as the median
per-epoch `motionIndex` — which is **0 on all 54 nights**, because a sleeping body is still for most
epochs. The tool reported `constant across nights`, and that row would have retired a named candidate
on an artefact of the *summariser* rather than on the data: the per-epoch series carries 38–39 distinct
values spanning 0–100 on the nights checked.

Replacing it with an upper quantile and a burden share (`motionP90`, IQR 24.2, 54 distinct values;
`motionActivePct`) produced a real test — which still found nothing, so the parent's conclusion is
unchanged. That is the point worth keeping:

> **A covariate that reads as constant is a claim about the summariser until you have looked at the
> underlying series.** The failure mode is silent and it looks exactly like a null.

The tool now prints each covariate's own spread (modal share · distinct count · IQR · range) beside its
p, and names any covariate where ≥ 50 % of nights share one value, so a null can be read as *"no
contrast to test"* where that is what it means. Two covariates trip it on this corpus
(`coverageEcgPct` 54 %, `ledAgreementPct` 56 %).

- [ ] Audit the other corpus tools for centrally-summarised zero-inflated variables. `motionIndex` is
      unlikely to be the only one; anything counting events per epoch has the same shape.

## 3 · Done when

- [ ] §1.1's box-only recomputation is run and its answer recorded either way, with n stated.
- [ ] Either the endpoint is confirmed sound (and the parent's negative stands as a statement about
      lockability), or it is recorded that per-block scatter conflates capture provenance with
      lockability — in which case the parent's question is **re-opened on the box subset**, not
      re-answered on the whole corpus.
- [ ] No unwrap is shipped on the strength of any of this. The parent's §7 still governs: a third
      implementation is not warranted until a night can be classified *before* the fit.

## 4 · Explicitly out of scope

Re-attempting the unwrap, and any further parameter sweep. §2 of the parent is unchanged — the
apparatus already sweeps, and sweeping does not separate the populations.
