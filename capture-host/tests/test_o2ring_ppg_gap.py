# tepna-capture — tests/test_o2ring_ppg_gap.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""O2Ring PPG honest-gap insertion (O2RING-PPG-GAP §1).

The O2Ring streams samples with NO PER-SAMPLE clock, so the host lays them on a synthesized
~125 Hz grid indexed by a running counter (seeded from O2PPG_FS_DEFAULT, then slewed to the
observed rows). (The ring's 1 Hz `duration_s` session counter is a separate thing and cannot
place 125 Hz samples — see the `O2PpgGrid` docstring, corrected 2026-09-06.) Before this fix that counter was purely
contiguous: when BLE dropped a frame, the survivors were written back-to-back ACROSS the
missing real time. The record was silently COMPRESSED — an interval spanning the loss is
short by exactly the lost duration, so beat-to-beat variability is fabricated at every gap,
and nothing downstream could tell because the ns column stayed uniform by construction.

These tests pin the behaviour in BOTH directions, which is the point: a gap must appear when
time was really lost, and must NOT appear for ordinary BLE arrival jitter.

⚠️ ANCHORED AGAINST THE SESSION START, NOT THE PREVIOUS FRAME (2026-07-25 —
VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §1). The first implementation compared each arrival to the
PREVIOUS frame's. Since the advance is one-sided (never rewind), that rectified symmetric arrival
jitter into monotonic inflation: +210 s of elapsed time that never happened over 11.18 h of real
corpus, with rows/wall at nominal on every file — i.e. nothing was actually lost.

This file had the blind spot that let it ship: `test_arrival_jitter_below_threshold...` only ever
fed jitter BELOW the threshold, so it proved the one case that could not fail. Real jitter is a
DISTRIBUTION with a tail above the threshold, and it was the tail that got banked. The invariant
that would have caught it is `test_zero_loss_stream_with_jitter_tail_does_not_inflate_the_grid`
below: with zero loss by construction, grid duration must equal wall duration regardless of jitter.
"""
import datetime as _dt

import capture

# An explicit configured SEED for the grid (the pre-2026-08-08 constant). These tests pass it as
# `fs=FS` and prove the grid SLEWS off whatever seed it is given toward the observed rows, which is
# exactly why moving O2PPG_FS_DEFAULT to the honest 125.000 ADC rate is inert — the seed is not the
# answer. Kept at 125.738 so the slew is exercised across a realistic seed→true gap.
FS = 125.738
NS_STEP = int(1e9 / FS)
GAP_MIN_S = 0.040


def _grid(frames, gap_min_s=GAP_MIN_S, fs=FS):
    """Drive THE REAL grid — `capture.O2PpgGrid` — over a frame-arrival sequence.

    frames: [(arrival_datetime, n_samples), ...]
    -> (list of sensor_ns per written sample, gaps_inserted, samples_of_time_skipped)

    ⚠️ This used to be a RE-IMPLEMENTATION of the block inside `run_oxyii`'s BLE callback, carrying a
    note that it was "kept deliberately in step" with it. It was not, and could not be: two copies of a
    rule drift, and the assertions were pointed at the copy that ships to nobody. That is how the
    one-sided correction in CAPTURE-HOST-DEEP-AUDIT §A3 stayed green — the port and the shipped code
    agreed about the SAFE direction and neither was ever driven through the other one. The logic now
    lives in one place, and this file drives it.
    """
    g = capture.O2PpgGrid(fs=fs, gap_min_s=gap_min_s)
    out = []
    for arr, nps in frames:
        out.extend(g.frame(arr, nps))
    return out, g.gaps, g.lost


def _steady(n_frames, nps=21, t0=None, fs=FS):
    """A clean link: each frame arrives exactly when its samples say it should."""
    t0 = t0 or _dt.datetime(2026, 7, 21, 21, 8, 14)
    return [(t0 + _dt.timedelta(seconds=(i + 1) * nps / fs), nps) for i in range(n_frames)]


def test_clean_link_inserts_no_gap_and_stays_contiguous():
    ns, gaps, lost = _grid(_steady(40))
    assert gaps == 0 and lost == 0
    steps = {b - a for a, b in zip(ns, ns[1:])}
    assert steps == {NS_STEP}, f"clean link must stay one uniform step, got {steps}"


def test_lost_frame_inserts_a_gap_of_the_right_size():
    """The exact failure measured in the field: a frame goes missing and the survivors used to
    be laid down contiguously across the hole."""
    fr = _steady(10)
    # drop frame 5 entirely: frame 6 arrives one frame-duration late relative to its samples
    del fr[5]
    ns, gaps, lost = _grid(fr)
    assert gaps == 1, "a dropped frame must produce exactly one gap"
    assert 20 <= lost <= 22, f"a 21-sample frame lost => ~21 samples of skipped time, got {lost}"
    jumps = [b - a for a, b in zip(ns, ns[1:]) if b - a != NS_STEP]
    assert len(jumps) == 1
    assert abs(jumps[0] - (lost + 1) * NS_STEP) < NS_STEP, "the gap must span the lost duration"


def test_arrival_jitter_below_threshold_mints_no_phantom_gap():
    """Measured BLE frame-anchor jitter is sd 16.4 ms / p95 29 ms. None of that may become a gap,
    or a healthy link would be shredded into fabricated holes."""
    t0 = _dt.datetime(2026, 7, 21, 21, 8, 14)
    fr = []
    jitter = [0.0, 0.012, -0.010, 0.028, -0.015, 0.021, -0.008, 0.029, -0.019, 0.014]
    for i, j in enumerate(jitter):
        fr.append((t0 + _dt.timedelta(seconds=(i + 1) * 21 / FS + j), 21))
    ns, gaps, lost = _grid(fr)
    assert gaps == 0, f"jitter up to 29 ms must not mint a gap, got {gaps}"
    assert {b - a for a, b in zip(ns, ns[1:])} == {NS_STEP}


def test_never_rewinds_on_an_early_frame():
    """A frame delivered 'early' by host-clock jitter must not rewind the grid — non-monotonic
    sensor_ns would break the Clock Contract and every downstream parser."""
    t0 = _dt.datetime(2026, 7, 21, 21, 8, 14)
    fr = [(t0 + _dt.timedelta(seconds=21 / FS), 21),
          (t0 + _dt.timedelta(seconds=21 / FS + 0.001), 21),   # absurdly early
          (t0 + _dt.timedelta(seconds=3 * 21 / FS), 21)]
    ns, gaps, lost = _grid(fr)
    assert all(b > a for a, b in zip(ns, ns[1:])), "sensor_ns must be strictly increasing"
    assert lost >= 0


def _inflation(frames, ns, fs=FS):
    """(grid_seconds / wall_seconds) - 1 — the quantity that actually matters. The grid must claim
    exactly as much elapsed time as really passed; anything above zero is time that was invented."""
    wall = (frames[-1][0] - frames[0][0]).total_seconds()
    grid = (ns[-1] - ns[0]) / 1e9
    return grid / wall - 1.0


def test_zero_loss_stream_with_jitter_tail_does_not_inflate_the_grid():
    """THE regression this file previously could not see (VIGIL-PPG-GRID-AUDIT §1).

    Every frame carries every sample at exactly nominal rate — zero loss BY CONSTRUCTION — and only
    the ARRIVAL time jitters, with a realistic tail ABOVE the 40 ms threshold. Under the old
    frame-to-frame comparison the one-sided advance banked each positive excursion and discarded the
    negative ones, inflating a lossless stream by +3.2 % and minting 1264 phantom gaps.

    The jitter must be GAUSSIAN, not a bounded waveform: it is the TAIL past the threshold that gets
    banked, so a jitter model whose peak sits below 40 ms exercises nothing and would reproduce this
    file's original blind spot. Seeded for reproducibility — deterministic, not seed-dependent.
    """
    import random
    rnd = random.Random(20260725)
    t0 = _dt.datetime(2026, 7, 25, 2, 0, 0)
    nps, n = 8, 4000
    fr = []
    for i in range(n):
        # sd 16.4 ms — the arrival jitter capture.py's own comment measured on a real overnight.
        j = rnd.gauss(0, 0.0164)
        fr.append((t0 + _dt.timedelta(seconds=(i + 1) * nps / FS + j), nps))
    assert max(abs(j) for j in
               [(f[0] - t0).total_seconds() - (i + 1) * nps / FS for i, f in enumerate(fr)]) > GAP_MIN_S, \
        "the jitter model must actually exceed the gap threshold, or this test proves nothing"
    ns, gaps, lost = _grid(fr)
    assert all(b > a for a, b in zip(ns, ns[1:])), "sensor_ns must stay strictly increasing"
    infl = _inflation(fr, ns)
    assert abs(infl) < 0.001, (
        f"a ZERO-LOSS stream inflated the grid by {infl:+.3%} across {gaps} inserted gap(s) — "
        f"arrival jitter is being rectified into fabricated elapsed time")


def test_slow_clock_drift_corrects_toward_the_host_clock_without_overshooting():
    """The ring's true rate (measured 125.726 Hz) differs from the configured 125.738 by ~0.01 %.

    The anchored grid deliberately CORRECTS this — and that is right, not a defect: the host clock is
    NTP-disciplined (stratum-1/PPS on this box), the ring's free-running oscillator is not, so pulling
    the grid toward host time restores the true elapsed span. The old frame-delta scheme could not do
    this and the old test asserted `gaps == 0`, pinning the mechanism instead of the outcome.

    What must hold is that the correction TRACKS the real drift and does not overshoot it.
    """
    true_fs = 125.726
    t0 = _dt.datetime(2026, 7, 21, 21, 8, 14)
    fr = [(t0 + _dt.timedelta(seconds=(i + 1) * 21 / true_fs), 21) for i in range(3000)]
    ns, gaps, lost = _grid(fr, fs=FS)
    infl = _inflation(fr, ns)
    assert abs(infl) < 0.0005, f"correction must track the ~0.01% drift, not overshoot it: {infl:+.4%}"
    assert lost / FS < 0.1, f"~8 min at 0.01% drift is <0.1 s of correction, got {lost / FS:.3f} s"


def test_gap_threshold_sits_between_measured_jitter_and_measured_loss():
    """Guards the constant itself against being retuned by taste. Field measurement over 119 min:
    frame-anchor jitter sd 16.4 ms, p95 |step| 29 ms; genuine losses median 49 ms, p90 96 ms."""
    assert GAP_MIN_S > 0.029, "threshold must sit above the p95 arrival jitter"
    assert GAP_MIN_S < 0.049, "threshold must sit below the median real loss"


def test_capture_module_exposes_the_threshold_and_default_matches():
    import importlib
    cap = importlib.import_module("capture")
    assert hasattr(cap, "O2PPG_GAP_MIN_S")
    assert abs(cap.O2PPG_GAP_MIN_S - GAP_MIN_S) < 1e-9


# ── the ring runs FASTER than configured (CAPTURE-HOST-DEEP-AUDIT §A3) ─────────────────────────
def test_fast_clock_drift_corrects_toward_the_host_clock():
    """THE §A3 regression, and the direction the old grid could not survive.

    The session-anchored correction only ever ADVANCED (`if target - idx > threshold`). That is safe
    while the ring runs SLOWER than the configured rate — the branch fires and pulls the grid forward.
    When it runs FASTER the difference is monotonically NEGATIVE, the branch can never fire, and the
    grid runs ahead of real time without bound.

    And faster is the real case, not the hypothetical one: `rows/wall` (a ROW rate — samples plus the
    inserted `156` beat markers) exceeds even the pre-2026-08-08 seed of 125.738 on every day of the corpus
    (07-18 125.826 … 07-26 126.045), and clears the honest 125.000 ADC seed by more still. The old constant
    labelled the sample clock with that row rate; the grid slewing up from any seed is what makes it moot.

    Measured against the pre-fix grid (the step held at the configured constant): +0.2561 %, i.e. +9.2 s
    of fabricated elapsed time per hour, on the finger-PPG leg PpgDex derives HRV from."""
    true_fs = 126.02
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)
    fr = [(t0 + _dt.timedelta(seconds=(i + 1) * 21 / true_fs), 21) for i in range(20000)]   # ~55 min
    ns, gaps, lost = _grid(fr, fs=FS)
    assert all(b > a for a, b in zip(ns, ns[1:])), "sensor_ns must stay strictly increasing"
    infl = _inflation(fr, ns)
    assert abs(infl) < 0.0005, f"a ring running fast inflated the grid by {infl:+.4%}"
    assert gaps == 0, "a fast ring loses nothing — inventing gaps for it would be the opposite error"


def test_the_warm_up_error_is_bounded_and_does_not_accumulate():
    """The step cannot be measured before there is enough elapsed time to measure it, so the first
    `_O2PPG_EST_MIN_S` runs at the configured rate and freezes that error into the accumulated column —
    it cannot be corrected retroactively without rewinding samples already written.

    What matters is that it is a ONE-OFF, not a rate: a fixed ~0.07 s that shrinks as a fraction of the
    night, where the defect it replaces accumulated +9.2 s every hour forever. Stated as a test so the
    residual is documented rather than discovered.

    Measured against the TRUE rate over the same sample span, not via `_inflation` — that helper divides
    a sample span by a frame-ARRIVAL span, which carries a constant ~0.16 s offset of its own (the 20
    samples the first frame back-times before its arrival). Harmless where it is used to bound a
    percentage; it would be three quarters of the quantity under test here."""
    true_fs = 126.02
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)

    def warm_up_seconds(minutes):
        n = int(minutes * 60 * true_fs / 21)
        fr = [(t0 + _dt.timedelta(seconds=(i + 1) * 21 / true_fs), 21) for i in range(n)]
        ns, _, _ = _grid(fr, fs=FS)
        return (ns[-1] - ns[0]) / 1e9 - (len(ns) - 1) / true_fs

    short, long = warm_up_seconds(5), warm_up_seconds(60)
    assert 0 <= short < 0.1, f"the warm-up error must be bounded: {short:.3f} s"
    assert abs(long - short) < 0.01, (
        f"the residual must not GROW with session length ({short:.4f} s over 5 min vs {long:.4f} s "
        f"over 60 min) — a residual that grows with time is a rate error, which is the defect")


def test_the_measured_rate_converges_on_the_rings_true_rate():
    """The step is MEASURED, not assumed. Re-calibrating the constant would repeat the 2026-07-18 fix
    with a new number and leave the asymmetry in place; measuring removes the asymmetry."""
    true_fs = 126.02
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)
    g = capture.O2PpgGrid(fs=FS)
    assert abs(g.fs - FS) < 1e-9, "it starts at the configured rate"
    for i in range(3000):
        g.frame(t0 + _dt.timedelta(seconds=(i + 1) * 21 / true_fs), 21)
    assert abs(g.fs - true_fs) < 0.02, f"measured {g.fs:.3f} Hz, ring runs at {true_fs}"


def test_a_lossy_link_does_not_drag_the_rate_estimate():
    """The two mechanisms must stay separated. An inserted gap raises `idx` while elapsed does not
    move, so an estimator that spans a gap sees a shorter apparent period, raises the rate, makes
    `target` outrun `idx` and inserts MORE gaps. That runaway measured +1.04 % inflation and 118
    phantom gaps on a ZERO-LOSS stream while this was being written — it is a real failure mode of the
    obvious implementation, not a hypothetical one."""
    true_fs = 125.738
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)
    fr = []
    for i in range(3000):
        if i % 200 == 100:
            continue                      # drop a whole frame every ~33 s: genuine, repeated loss
        fr.append((t0 + _dt.timedelta(seconds=(i + 1) * 21 / true_fs), 21))
    ns, gaps, lost = _grid(fr, fs=FS)
    assert gaps >= 10, "the dropped frames must still be seen as real loss"
    assert all(b > a for a, b in zip(ns, ns[1:]))
    infl = _inflation(fr, ns)
    assert abs(infl) < 0.001, f"loss dragged the rate estimate: {infl:+.3%} inflation"


def test_the_rate_estimate_cannot_claim_an_absurd_rate():
    """A clamp, because an estimate is only as good as its anchor. A ring genuinely outside ±5 % is a
    different unit rather than drift, and belongs in `o2ring.ppg_fs` where a human can see it."""
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)
    g = capture.O2PpgGrid(fs=FS)
    for i in range(3000):                 # a "ring" at 200 Hz — far outside anything real
        g.frame(t0 + _dt.timedelta(seconds=(i + 1) * 21 / 200.0), 21)
    assert g.fs <= FS * 1.05 + 1e-9, f"estimate escaped the band: {g.fs:.3f} Hz"


def test_the_step_shrinks_without_ever_rewinding_the_ns_column():
    """The emitted ns is ACCUMULATED, never `idx * step`. Recomputing it from a shrinking step would
    move samples already written and emit a non-monotonic column, which every parser depends on not
    happening."""
    t0 = _dt.datetime(2026, 7, 26, 2, 0, 0)
    g = capture.O2PpgGrid(fs=FS)
    ns = []
    for i in range(3000):
        ns.extend(g.frame(t0 + _dt.timedelta(seconds=(i + 1) * 21 / 126.02), 21))
    assert g.step_s < 1.0 / FS, "the step must actually have shortened"
    assert all(b > a for a, b in zip(ns, ns[1:])), "sensor_ns must be strictly increasing"
