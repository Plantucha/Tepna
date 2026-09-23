<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (measurement record — 2026-09-05 hardware session, three-device stack on the box) · **Created:** 2026-09-05 · **Confirms:** `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` §4b's co-location correction, first hardware test · **Corrects:** `O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md` §2b's detector choice · **Defers to:** `PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md` §3–4 and `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §3e on timing

# The commanded buzz is a real cross-device marker — but only by co-location, and never as a clock

Nine commanded buzzes across three runs, three devices on one box, live capture. **The marker works.
The timing route it was proposed for does not, and the repo already said so.**

## 1 · The headline: co-location, confirmed on hardware

`KNOWN-CLOCK-ADVERSARIAL-CAPTURE` §4b was corrected on 2026-08-15 after the owner challenged it: a tap
is a LOCAL event, tissue damps and delays it, *"a marker that relies on TRANSMISSION between body
segments does not work here"*, and what works is **co-location — one sharp impulse while the devices
are momentarily a single rigid body. The clapperboard principle.** That correction was reasoned, not
measured. **This is its measurement, and it holds.**

    condition          ring→Verity→H10 contact   H10 ACC        Verity ACC
    STACKED (2 runs)   rigid, touching           85–142x        109–155x
    APART   (1 run)    ring on finger, separate   2–5x            2x

**Six co-located buzzes detected, three separated buzzes not.** No overlap between the distributions.
A vibration in a ring on a finger does not reach a chest strap; the same vibration through a stack of
touching housings reaches it at ~100×.

⚠️ The separated run is what makes this evidence rather than an anecdote. A positive-only run cannot
distinguish "the marker couples" from "the devices were bumped".

## 2 · Only accelerometers detect it — which contradicts the brief that proposed the method

`O2RING-BUZZ-FIDUCIAL` §2b names the ring's **125 Hz pleth** as the ring-side detector. It is not one.
Every stream, both conditions, magnitude relative to that stream's own p90 of |Δ|:

| stream | Hz | stacked | apart | separates? |
|---|---|---|---|---|
| **Verity ACC** | 50 | **109–155×** | 2× | ✅ best |
| **H10 ACC** | 203 | **85–142×** | 2–5× | ✅ |
| ring PPG | 120 | 24–26× | 11–17× | ❌ ranges touch; mostly pulse waveform |
| H10 ECG | 130 | 7–12× | 6–10× | ❌ **overlapping** |
| Verity PPG | 55 | 2–7× | 4–6× | ❌ overlapping, lower stacked twice |
| ring PPG2W | 180 | ~1× | ~1× | ❌ nothing, despite the fastest rate |
| ring ACC | 9–10 | 0–2× (one 55×) | 2–4× | ❌ **inverted** |

Three findings a plan built on §2b would get wrong:

- **The optical channels do not discriminate.** The buzz does not perturb the pleth above its own
  beat-to-beat variation. §2b's ±8 ms pleth resolution is irrelevant if the artifact is not there.
- **The ECG is silent.** 7–12× stacked against 6–10× apart. The buzz shakes the pod and does not reach
  the electrodes. Without the apart run those 7–12× spikes read as detection.
- 🔴 **The ring's OWN accelerometer is the worst detector of its own buzz.** 0–2× when stacked, *better*
  when free (2–4×). Clamped between body and Verity it cannot move; the buzzing device is the one that
  cannot see the buzz. The intuitive detector is the wrong one.

## 3 · The buzz must NOT be used to time anything

The command stamp is not the event. `ring_buzz_at` records the COMMAND; the ring fires on its next
poll (~1 Hz), so observed lags ran **0.21–1.41 s** across detections. Worse, the per-sample
`Phone timestamp` in the signal files is **back-timed across the packet** from a single arrival
(`PAT-PACKET-ARRIVAL` §3), so artifact onsets are read against derived stamps.

Timing the artifacts anyway gave **+440 ms (spread 80)** and **+388 ms (spread 206)** — and a device
clock sync of **3.4 s** moved it **52 ms**, i.e. inside the run-to-run noise. That is consistent with
`PAT-UNDER-PERBLOCK-ALIGNMENT` §3e, which measured ACC anchors disagreeing **with themselves** by
1171–3094 ms and concluded no model built on them can work. **This session built a fourth such model
before reading that.** It is recorded here so a fifth is not built.

## 4 · Three offset methods compared, on the same session

| method | estimates | Verity − H10 | spread |
|---|---|---|---|
| **C** PMDARRIVAL min-filter | best-case transport ≈ true offset | **+994.7 ms** | ±1.8 (n-bias) |
| **B** hostAxis running median | *typical* transport incl. queueing | +2428.8 ms | IQR 311.6 |
| **A** ACC buzz artifact | event via back-timed stamps | +440 / +388 ms | 80 / 206 |

**They must not be averaged — they estimate different quantities**, and the mechanism is the packet
asymmetry: H10 **191 packets/min**, Verity **29/min**. The Verity's fewer, larger packets wait longer,
so the *median* inherits that queueing while the *minimum* strips it. This is why NTP filters on the
minimum, and `CROSS-DOMAIN-METHODS-FOLLOWUPS` already records the repo agreeing with that citation.

**The min-filter's sample-size bias was measured, not assumed:** re-drawing the H10's minimum 400 times
at the Verity's n=4953 moves it **+1.8 ms** (p5–p95 154.0–158.3). The estimator has converged; the bias
is negligible and the raw +996.5 becomes **+994.7 ms** corrected.

⚠️ **That is ~2.5× larger than every night in `PAT-UNDER-PERBLOCK` §3e.4's table (−155…+392 ms).**
Tonight's Verity was off-body, sandwiched, and had a link-instability burst. Do not treat +995 ms as
typical without a normal night.

⚠️ **And a scalar is the wrong shape.** §3e.4's finding is that the offset **wanders over hours** — IQR
grew monotonically 39 ms at 123 min → 128 ms at 563 min. One minimum over a session collapses exactly
the structure that matters.

## 5 · Incidental defects found

- 🔴 **An implausible clock skew passed unguarded.** The Verity reported
  `clock_skew_sec = -841915056.2` (**−26.7 years**) for one poll, with `clock_uncorrectable = False`,
  then self-corrected. Nothing rejected it. Anything consuming that value to correct a timebase would
  have destroyed the night. A plausibility bound belongs on that field.
- **`/api/timesync/all` reports `ok: true` for a device it SKIPS.** The O2Ring returns
  `{"ok": true, "skipped": "auto", "detail": "re-syncs on every connect"}` — a success-shaped response
  for work not done. The ring's `clock_skew_sec` is `None`, so its clock is unverified.
- **`acc_h10` read `effFs=None` while the card displayed "200 Hz"**, and a run fired in that state
  produced a 34 s gap covering every buzz. The configured rate is displayed; the delivered rate is not.
  A run must pre-flight the *measured* rate, not the label.
- **A rate change applies only at connect.** `POST /api/settings` returned `restart_needed: true` and
  the H10 kept 50 Hz until it reconnected — the same shape as the Verity's `ppg: 176`.

## 6 · What to do instead

1. **Use the buzz as a MARKER, not a clock** — for confirming two devices were co-located, for
   segmenting a recording, for `KNOWN-CLOCK-ADVERSARIAL-CAPTURE` target 1's clapperboard. It is
   excellent at that and now measured.
2. **Take offsets from `_PMDARRIVAL.csv` with the minimum filter.** Both Polars share the
   2000-01-01 sensor epoch, so it cancels in the difference. The ring is excluded — it writes
   `sensor_ns = 0` because it exposes no device clock.
3. **Report offset-versus-time, never a scalar**, per §3e.4's wandering result.
4. **Do not build a fifth motion-based estimator.**

**Done when** *(none of these are claimed here)*

- [ ] a normal on-body night measured by method C, to test whether +995 ms is tonight-specific
- [ ] offset-versus-time over hours, IQR against §3e.4's 39–128 ms
- [ ] a plausibility bound on `clock_skew_sec`, with the −26.7 year sample as its test case
- [ ] `/api/timesync/all` distinguishes "synced" from "skipped" in its per-device `ok`
