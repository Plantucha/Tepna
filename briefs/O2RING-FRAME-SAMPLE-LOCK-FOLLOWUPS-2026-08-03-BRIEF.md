<!--
  O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — 5 of 6 done-when boxes are closed and dated, which the previous bare `PROPOSED` header hid. The single open item is §6, and its blocker is PROCUREMENT, not engineering: every number in the parent brief derives from ONE physical unit (`S8AW2100`) — the 126:1 lock, 126.037 frames/device-second, −3446 ppm, the ±1 s quantization and the +11 ms re-anchor residual — and none of them can be shown to be a property of the MODEL rather than of that individual until a second ring exists. Repo-wide there is exactly one serial. No code closes this. **Owner:** owner (buy or borrow a second O2Ring) · **Next step:** an owner decision on whether a second unit is worth it; if not, record that the constants are single-unit and stop carrying §6) · **Created:** 2026-08-03

# What executing the 126:1 lock left open

Residue from building `O2RING-FRAME-SAMPLE-LOCK` §4(a) (executed 2026-08-03, recorded in that brief's
§7). Each item is a question the execution raised and could not close, with the reason.

## 1 · Confirm §7.2 forward, from `ppg_n` rather than by reconstruction — UNBLOCKED, NEEDS ONE NIGHT

> **Re-checked 2026-08-04, later the same day: the deploy half is DONE, the night half is not.**
> `/opt/tepna` is at `d6b8fa5` and its `writers.py:431` carries the 12-column header, and the daemon was
> restarted at **12:22:07 EDT**, so the *running* process now writes `ppg_n` / `ppg_dur_step`.
>
> **No file has them yet, and the reason is worth stating precisely rather than as "not yet deployed":**
> every one of the 220 sidecars on the box predates that restart — the newest is `20260804083004`, four
> hours before it. The earlier check above read the same absence and attributed it to the box not having
> the code; the box *had* the code, on disk, unexecuted. **Having the code and running it are two facts,
> and the sidecar can only ever witness the second.** (Same distinction, one layer down, as the four-day
> stale-daemon event that `VIGIL-AUTO-UPDATE` exists to prevent — and the reason that updater restarts
> rather than merely pulling.)
>
> So this item now costs exactly **one night worn**, with no deploy, no code and no analysis in front of it.

The per-frame sample counts in §7.2 were recovered **indirectly** — by matching `OXYFRAME` arrival
stamps against the `PPG` phone-timestamp column, exploiting that each frame's last sample is stamped at
its arrival. The match is sound (2 ms median residual, 33 513 frames) but it is an inference about where
frame boundaries lie, and the whole point of §7 is that inferences about this device keep turning out to
be the third reading of the same data.

`ppg_n` now records the declared count directly. **One night reads it off the file**: group `ppg_n` by
`ppg_dur_step` and confirm `+2` steps carry ~127 rather than ~252. Costs a night and no code.

## 2 · MEASURED 2026-08-04 — the model predicts the SHAPE, and the level to within ~2x

Built as `capture.predict_step_split` and tested against **66 clean sessions**. The quantitative form:
the ring's counter reads `floor(t / ring + phase)`, so between two polls it advances by 1 plus whichever
way the fractional phase wrapped. With the phase equidistributed — it sweeps ~22 full cycles across a
night — and a per-poll relative error `eps = (delta - ring) / ring`:

```
n(step=2) / N = E[eps+]          n(step=0) / N = E[eps-]
```

**What it gets right:** the step alphabet ({0,1,2} and nothing else, matching the corpus), the sign
(a poll interval shorter than the ring second slips the phase backwards, so 0s must outnumber 2s — and
they do, 180 vs 159), and the scale.

**What it gets wrong: the level, by a stable factor.** Median over-prediction **1.85x**, IQR
**1.46-2.21**. So §2 as posed — *"a model that predicts the ratio would turn §7.2 from an explanation
into a measurement"* — is **not achieved**. It is a bound, good to about a factor of two.

⚠️ **The identity is not evidence.** `n0 - n2 = N * (1 - mean step)` follows from `mean = (n1 + 2*n2)/N`
and `N = n0+n1+n2` by algebra alone — it holds for *any* data with steps in {0,1,2} and cannot test
anything. A first pass here mistook its agreement (predicted 22, observed 21) for a confirmation.

### 2.1 · Why it over-predicts, and why that cannot be settled from what is recorded
`E[eps+]` is **convex**, so independent noise on the measured interval can only inflate it. The sidecar
records **host arrival** times, while the ring samples its counter when it builds the reply — so the
measured interval carries BLE delivery jitter the ring never saw. Simulation puts a 1.85x inflation at
plausible ratios (~5 ms true poll jitter with ~8 ms delivery jitter).

That explanation is **not refuted** by the near-zero correlation between over-prediction and total
arrival jitter (**r = +0.06**, 66 sessions), because the inflation depends on the delivery/poll **ratio**
— roughly constant across one daemon — and not on the total. But it is also **not confirmed**, and it
cannot be from this data: nothing records when the poll was *issued*.

**The cheap fix is capture-side:** one more column, the poll-issue time beside the arrival time, makes
the model directly testable. Same shape as §1's dependency — a recording change, not an analysis one.

### 2.1a · CONFIRMED 2026-08-04 — and the sentence above it is wrong

> ⚠️ **"It cannot be settled from what is recorded" was false, and false in this repo's signature way:**
> it reasoned from the one test that would be *direct* (the poll-issue column) and never asked whether an
> *indirect* one existed. It does, it needed no new recording, and it took one afternoon on data that had
> been sitting on the box the whole time. The poll-issue column is still the direct test; it was never the
> only one. **Before writing that something cannot be measured, look for the oblique measurement.**

Re-run over the **whole box corpus** — 220 OXYFRAME sidecars, 2026-07-25 → 08-04, of which **62 sessions
carry ≥200 usable intervals: 324,073 intervals**, an order of magnitude past §2's 66 sessions. Excluded:
28 intervals as dropouts (>5 s) or counter resets.

**The over-prediction reproduces**, a little lower than §2's figure and containing it:

| | flat (step 0) | double (step 2+) |
|---|---|---|
| observed | 3,659 | 1,958 |
| predicted | 4,532 | 2,838 |
| **ratio** | **1.24x** | **1.45x** |

Pooled **1.31x**; median per session **1.64x** (IQR 1.01–2.21). §2's 1.85x sits inside that spread.

**Two measurements identify the cause, neither needing a new column:**

1. **A phase accumulator is WORSE** — carrying fractional phase across polls instead of taking a
   per-interval expectation gives **1.35x / 1.63x** against the shipped **1.24x / 1.45x**. So the
   equidistributed-phase assumption is *not* what fails. This was the author's own leading hypothesis
   (that summing `|eps|` double-counts jitter which cancels), and it is **refuted** — recorded rather
   than quietly dropped, because a wrong hypothesis that was tested is worth more than a right one that
   was assumed.
2. **Smoothing removes the excess monotonically, and crosses 1.00 at width ~2**:

   | host stamps | flat ratio | double ratio |
   |---|---|---|
   | raw | 1.24 | 1.45 |
   | median 3 | 0.87 | 0.76 |
   | median 9 | 0.69 | 0.43 |
   | median 21 | 0.64 | 0.32 |
   | median 81 | 0.60 | 0.26 |

   **An excess that lives at the adjacent-sample scale is delivery jitter.** Real clock divergence is by
   construction the *low-frequency* part and would survive smoothing; this does not. That is the
   signature, and it is what the direct test would have confirmed.

**The jitter, measured:** 20.8 ms robust sigma against each session's own 21-median (IQR 13.3–29.7, max
315.8) — **2.1 % of a ring second** — and integrated over a session its pressure (**5,192**) is the same
order as the *entire* observed step count (**5,617**). Consistent with `DexClock.hostAxis`'s own finding
that host stamps carry ~0.1 s of BLE delivery jitter, which is why that function medians rather than fits.

⚠️ **Do not pick a smoothing width to make the ratio 1.00.** Signal and noise share a band here, so every
width that flattens the bias also destroys the divergence being measured — med-21 under-reads doubles by
3x. Choosing a width by the ratio it produces is **selecting on the outcome**, the error
`PAT-VERDICT-CONSOLIDATED` §5 records this repo paying for twice. `predict_step_split` therefore stays a
**bound** — but a bound whose slack now has a measured cause instead of a plausible one.

### 2.2 · Gated
`predict_step_split` ships with the 1.85x bound in its own docstring, so the output cannot be read as
exact. Four assertions: pure drift gives backward wraps only; zero-mean jitter moves n0 and n2 together
and leaves their difference alone; **noise on the input inflates both predictions** (the convexity that
explains the 1.85x, asserted so that "fixing" the gap by scaling the output is visibly a fudge — the
defect is in the input, not the formula); and no usable input returns NaN rather than a guess.
Mutation-verified: collapsing the sign split fails the drift assertion.

## 3 · RESOLVED 2026-08-04 — `counted_loss` is RETIRED, because neither option works

Decided, and the decision is closed rather than preferred: **the counter cannot be made informative
under any nominal.**

- With a **fitted** nominal — the per-second rate estimated from the session itself — `expected`
  converges on `declared` and the residual is identically ~0. That is a statistic whose reference comes
  from the data it is testing, the exact defect this brief family keeps finding (`matchRate`'s stage
  two; `strictMatchRate.residIQR`).
- With a **fixed** nominal the constant's error is the same order as any loss it could detect: 126
  against a measured **126.04** per device-second with a **125.6–126.5** per-session spread. On the
  reference night it read **−5 120 samples** — a *surplus*.

There is no third option, so it was removed rather than documented, along with `expected`, the
`nominal` parameter and the `ppg_expected` sidecar column. **Removed before any capture was written in
that format** — the box had not been redeployed since the counter shipped, so the column cost nothing
to take back. `truncated` and the step counters need no constant and stay.

The 126-per-device-second figure remains in `oxyii.PPG_FRAME_SAMPLES` as documented protocol knowledge;
it is simply no longer used to compute anything.

## 4 · The status frame's PHASE relative to its 126 samples — the same unknown as §5.3's δ

Carried forward from the parent brief's §4: knowing the ratio is 126:1 and that the host column
re-anchors every frame does not say *where in the 126* the status frame sits, nor whether the re-anchor
is applied at the boundary or distributed across it.

**§5 showed this is not a separate open item.** An unknown constant phase within the frame and §5.3's
unknown constant δ (differential BLE latency) are the *same quantity* reached from two directions — both
are a fixed offset between the ring's sample times and true instants, and neither is separable from the
other without an external reference. That has two consequences:

- **For the coupling question, neither needs solving** — the strict statistic's leave-one-block-out
  centre absorbs any constant (§5.3).
- **For ABSOLUTE PAT, solving either solves both**, and nothing in the corpus can do it: the only
  non-circular reference would be shared mechanical motion, and the ring has no ACC (§5.3). Aligning on
  beats instead is precisely `CROSS-DEVICE-DRIFT-AND-CLOSURE` §3.6's trap.

So absolute PAT on the ring is **blocked on hardware, not on analysis** — it needs a motion channel the
ring does not expose. `O2RING-OPCODE-SURFACE` lists 25 undocumented opcodes; whether any exposes the
accelerometer behind the 1 Hz `motion` byte is the only cheap way this reopens. (The 1 Hz `motion` field
itself is ~5× too coarse: PAT needs tens of ms, one sample per second gives ~1 s.)

## 5 · `Σ N` as a `hostAxis` anchor — SCOPED 2026-08-04, and the blocker is not here

§7.4 argues cumulative `Σ N` gives `DexClock.hostAxis` a genuine `{devMs, hostMs}` pair at ~1 Hz. A
scoping pass answered three questions; the answers move the blocker somewhere else entirely.

### 5.1 · Corpus — not the constraint  `[CORPUS]`
**16 pairs / 38.1 h** of simultaneous **box-captured** O2Ring finger PPG + Polar H10 ECG, the largest a
**9.3 h** night (`…20260801224728` ↔ `…20260801224539`). Box-captured only, deliberately: phone nights
put two wearables ~3.3 s apart against ~0.2 s on box nights.

### 5.2 · The ring's timing is NOT the problem  `[CORPUS]`
Per-frame re-anchor corrections on that night: **median +3.1 ms, IQR 8.0 ms**, p5–p95 ±19 ms, and only
**0.0086 %** of samples carry a correction beyond 60 ms. Against `pat-gate.js`'s `residIQR ≤ 60 ms` that
is **7.5× inside the bound**, and it is robust to the baseline (8.0 ms either against the ms-rounded
8.000 or the true 7.948 step). The anchor spacing came out at a median of **126 samples**, confirming the
parent brief's 126:1 lock a third independent way.

**So "the ring is too jittery for PAT" is refuted, and §7.4's caveat is narrower than it was written.**

### 5.3 · The ring has NO accelerometer — its route is constant-δ, not ACC  `[CODE]` `[CORPUS]`
`tools/pat-matchrate-strict.mjs` aligns the two devices via **shared mechanical motion in both ACC
streams**. The ring emits `SPO2` / `PPG` / `OXYFRAME` and **no ACC at all**, so that path can never run
for an O2Ring↔H10 pair.

That is less fatal than it looks. The ACC anchors correct a **drifting** offset between two independent
device clocks; a box-captured pair shares **one** NTP-disciplined daemon and the ring has **no device
clock at all** (pure host-arrival back-timing). What remains is a **constant** δ — differential BLE
delivery latency — and the strict statistic's leave-one-block-out centre absorbs a constant by
construction. So the **coupling** question is answerable without knowing δ; **absolute** PAT is not.

⚠️ **The one unvalidated assumption:** that δ does not *drift* across a night. LOBO absorbs a constant,
not a ramp. Nothing here tested it, and it is the assumption §5.4's result rests on.

### 5.4 · The coupling run — negative, and the CONTROL is what matters  `[CORPUS]`
Ran with a zero constant offset over the 9.3 h night (scratch probe, not committed):

| | legacy | chance | ratio | p | **strict** | **chance** | **ratio** | **p** |
|---|---|---|---|---|---|---|---|---|
| O2Ring finger, 29 681 beats | 31 % | 19 % | 1.62 | 0.022 | **7 %** | **7 %** | **0.96** | **0.87** |

Indistinguishable from chance under the statistic that can fail — the legacy-says-yes / strict-says-no
pattern `PAT-UNDER-PERBLOCK-ALIGNMENT` §3a built its null to expose.

> ⚠️ **SUPERSEDED IN PART 2026-08-04 — this result inherits a rule now known to be biased.**
> `PAT-UNDER-PERBLOCK-ALIGNMENT` §3c shows the largest-true-overlap pair rule is **anti-correlated**
> with `matchRate`, so the run above scored the *least* favourable pair. It remains true that the ring
> matches the Verity leg under the same rule (below) — the comparison is like-for-like — but the
> **negative itself must not be quoted** until §3c.5's outcome-independent selection lands.

**The control was already published and it exonerates the ring.** §3a's six **Verity** nights, run *with*
the real ACC alignment, score strict **5–9 %**, **four of six below chance** (e.g. 0.93 at p = 0.83).
The ring's numbers are statistically identical. **Nothing here is ring-specific.**

### 5.5 · What actually blocks PAT — an open item in the parent PAT brief, not in this one
`PAT-UNDER-PERBLOCK-ALIGNMENT` §3a's own unresolved blocker:

> legacy `matchRate` reads **24–42 %** here against **90–96 %** there … **Until the gap is explained, the
> strict numbers above are a method result, not a verdict on PAT.**

The legacy numbers measured above (**31 %**, chance **19 %**) land squarely in the §3a harness's range,
so this pass **reproduced the ~3× discrepancy rather than resolving it**. Two harnesses disagreeing 3×
on the same statistic over the same nights means **neither a positive nor a negative PAT result
currently carries information** — including §5.4's.

**Recommendation: do not attempt PAT on the ring next.** Reconcile the two harnesses first (§3a names
the likely cause: pair selection among BLE-reconnect fragments). It is bounded, and it gates every PAT
result including this one. When it is settled, this pass has already established that the corpus (§5.1)
and the ring's timing (§5.2) are adequate, and that the ring's route is constant-δ + LOBO (§5.3) with
δ-drift as the one thing left to validate.

## 6 · A second ring

Every number in the parent brief and in §7 comes from **one unit** (`S8AW2100`): the 126:1 lock, the
126.037 per device-second, the −3446 ppm, the ±1 s quantization behaviour, and the +11 ms re-anchor
residual. `O2RING-PROTOCOL` §3b already flags the rate as unit-specific; the same caveat now applies to
the lock and the counter quantization.

## Done when
- [x] **§1 CONFIRMED 2026-08-18, directly from `ppg_n` — the prediction holds and the blocker had
      gone stale.** The 2026-08-04 note above was right at the time and wrong by the 18th: it cost
      "one night worn", and fourteen nights have been worn since. **35 of 45 local `OXYFRAME` files now
      carry the columns** (newest 2026-08-16); the 10 without are pre-restart, exactly as the note
      predicted.
      Measured over **162 576 frames**, grouping `ppg_n` by `ppg_dur_step` as §1 specifies:

      | `ppg_dur_step` | frames | median `ppg_n` | mean | min | max |
      |---|---|---|---|---|---|
      | 0 | 55 424 | **0** | 1.8 | 0 | 177 |
      | 1 | 106 495 | **126** | 126.4 | 0 | 197 |
      | 2 | 656 | **127** | 127.6 | 67 | 177 |

      **A `+2` step carries ~127, not ~252** — the §1 prediction, now read off the device's own declared
      count rather than inferred from arrival-stamp matching. So a `+2` is one device-second of samples
      with the duration counter having skipped, **not** two seconds of data: the counter is quantized,
      and §7.2's indirect recovery was correct. The `dur_step 0 → ppg_n 0` row is the same fact from the
      other side — no advance, no samples.
      ⚠️ **One naming discrepancy worth recording:** §1 names `ppg_n` / `ppg_dur_step` / **`ppg_expected`**.
      The shipped header carries `ppg_n` / `ppg_dur_step` / **`ppg_offset`** — there is no `ppg_expected`
      column. The two the measurement needs are present, so this does not block §1, but a reader
      grepping for `ppg_expected` will find nothing and should not read that as the columns being absent. — **BLOCKED on a capture, not on work
      (checked 2026-08-04).** `ppg_n`/`ppg_dur_step`/`ppg_expected` landed in `capture-host/writers.py`
      on **2026-08-03** (`ec85357`). No OXYFRAME on disk carries them: the newest ring capture is
      2026-08-03 and still writes the old 10-column header, and 2026-08-04 has Verity files only — no
      O2Ring at all. §1 costs "a night and no code" and **the night has not happened**. It needs one
      recorded with the ring connected on current capture-host; nothing in the repo unblocks it.
- [x] **§3 decided 2026-08-04 — RETIRED.** Neither a fitted nor a fixed nominal can make it
      informative; the first is self-referential, the second carries bias the size of the signal.
- [x] **§5 SCOPED 2026-08-04** — corpus adequate (38.1 h / 16 pairs), ring timing adequate (IQR 8.0 ms,
      7.5× inside the PAT bound), route identified (constant-δ + LOBO), coupling run **negative** and the
      published Verity control shows it is **not ring-specific**. The blocker is `PAT-UNDER-PERBLOCK-
      ALIGNMENT` §3a's unresolved 3× harness discrepancy, which this pass reproduced.
- [x] **§4 resolved as a duplicate of §5.3** — phase and δ are one unknown; irrelevant to coupling,
      and blocked on hardware (no ACC) for absolute PAT.
- [x] **§2 MEASURED 2026-08-04 — the model is FALSIFIED.** §7.2 explains the 159/180 split as a beat
      between the ring's 1.00346 s second and the ~1.0028 s poll, and §2 asked for the prediction:
      imbalance should track the poll interval. Over the whole corpus (`tools/o2ring-step-imbalance.mjs`,
      1558 OXYFRAME sessions, **55 usable**):

      | poll cluster | n | observed imbalance | model predicts |
      |---|---|---|---|
      | 0.99030 s | 27 | **+0.00069** | −0.01312 |
      | 1.00450 s | 28 | **−0.00067** | +0.00104 |

      **Pearson r = −0.084.** The model predicts a sign change and a ~20× magnitude swing across the
      15 ms poll spread; observed is ~zero in both clusters and the weak trend runs the OPPOSITE way.
      So §7.2 stays an *explanation* and does not become a measurement, and `step_imbalance` is
      descriptive permanently rather than "until then". Whatever sets the 159/180 split, it is not the
      poll interval.

      ⚠ **The filter is the experiment.** 1503 of 1558 sessions have a `duration_s` that never advances
      (ring idle/disconnected) — every step 0, imbalance a degenerate −1.0. My first run left them in
      and reported a confident **r = −0.213 over "164 sessions"**, of which 109 were flat lines. A
      session counts only if a majority of its steps are +1.
- [ ] §6 — a second ring.
