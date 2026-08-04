# tepna-capture — tests/test_o2ring_frame_lock.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""O2Ring PPG sample accounting, COUNTED (O2RING-FRAME-SAMPLE-LOCK).

`O2PpgGrid` infers loss from arrival timing. The ring was declaring two numbers the host discarded —
the PPG sample count in `[24:26]` and the session second in `[0:4]` — and `O2PpgFrameLedger` counts
against them.

⚠️ THE FINDING IS A NEGATIVE ONE, AND THESE TESTS EXIST TO KEEP IT. `Δduration` is NOT a frame-loss
signal. A step of 2 looks exactly like "one status frame never arrived"; measured on 2026-08-01 over
33 513 frames (33 172 steps of +1, 180 of 0, 159 of +2, none of +3):

    HOST arrival interval, by step:   +0 -> 1.000 s   +1 -> 1.005 s   +2 -> 1.005 s
    PPG samples in the NEXT frame:    +0 ->   125     +1 ->   126     +2 ->   127

A missing frame would show a ~2.0 s interval; a recovered backlog would show ~252 samples. Both read
one second's worth — **no frame is missing.** The ring's second is 1.00346 host-seconds against a
1.0028 s poll, two nearly-equal periods, so the counter occasionally ticks twice or not at all. The 159
and the 180 nearly cancel, which is why `device_seconds` survives as a span while no single step does.

The same corpus confirms the thing that IS a loss measurement — weighted regression over 60 clean
sessions / 60.9 h, where a signal costing its samples must read −126.04:

    samples/device-second ~ 126.04  −  6.9 × steps_ahead_frac  −  128.9 × inferred_gap_frac

So `O2PpgGrid` is right and stays, and the counters here are named for what they ARE (steps in a
counter) rather than what they resemble. `test_a_duration_step_of_two_is_not_a_missing_frame` is the
assertion that stops this being re-read as loss — which has now happened twice, `frame_gap()` being
the first.
"""
import capture
import oxyii

# ── The declared count ──────────────────────────────────────────────────────────────────────────────
def _frame(n_declared: int, n_samples: int | None = None) -> bytes:
    """A 0x04 payload: 24-B status header, u16 LE declared count, then the samples that came with it.

    `n_samples` defaults to `n_declared` (an honest frame). Passing fewer builds the frame the whole
    `declared - delivered` column exists for — the ring said N and the bytes did not follow."""
    # Cycled mod 256 — the sample values are irrelevant here, but the count must be free to exceed 255
    # (that is the whole point of the u16 test), and a bare range() would raise past 255.
    body = bytes(i % 256 for i in range(n_declared if n_samples is None else n_samples))
    return bytes(24) + n_declared.to_bytes(2, "little") + body


def test_declared_count_is_u16_le_not_the_low_byte():
    """Above 255 the retired u8 read at [24] silently wraps. 256 is where they diverge."""
    assert oxyii.ppg_sample_count(_frame(126)) == 126
    assert oxyii.ppg_sample_count(_frame(256)) == 256, "[25] is the HIGH byte, not a flag"
    assert oxyii.ppg_sample_count(_frame(300)) == 300


def test_no_body_is_None_and_a_body_declaring_nothing_is_zero():
    """Blank-vs-zero, at the protocol edge: 'this frame has no waveform section' and 'the ring produced
    no samples this second' are different facts and must not both read as 0."""
    assert oxyii.ppg_sample_count(bytes(24)) is None, "header-only frame carries no count field"
    assert oxyii.ppg_sample_count(bytes(25)) is None, "a half-written count is not a count"
    assert oxyii.ppg_sample_count(bytes(26)) == 0, "count field present, declaring zero samples"


def test_parse_ppg_still_returns_the_samples_and_is_unchanged_at_the_edges():
    """Back-compat: single-sourcing the count on ppg_sample_count must not move parse_ppg's contract."""
    assert oxyii.parse_ppg(_frame(3)) == [0, 1, 2]
    assert oxyii.parse_ppg(bytes(24)) == [], "no body → no samples"
    assert oxyii.parse_ppg(bytes(26)) == [], "declaring zero → no samples"


def test_declared_and_delivered_are_allowed_to_disagree():
    """THE reason the count is surfaced separately: len(parse_ppg(p)) cannot tell these two apart."""
    truncated = _frame(126, 60)
    assert oxyii.ppg_sample_count(truncated) == 126
    assert len(oxyii.parse_ppg(truncated)) == 60


def test_frame_samples_nominal_is_per_device_second_and_is_not_the_sample_rate():
    """126 is a count per SESSION-SECOND. It is deliberately NOT reconciled with O2PPG_FS_DEFAULT: the
    ring's second runs -3446 ppm against the host, so 126/device-second is 125.80/host-second. Pinned
    because 'these two constants disagree, let me fix one' is the exact move both O2RING-PROTOCOL and
    O2RING-SYNTHESISED-AXIS forbid."""
    assert oxyii.PPG_FRAME_SAMPLES == 126
    assert oxyii.PPG_FRAME_SAMPLES != capture.O2PPG_FS_DEFAULT
    assert capture.O2PPG_FS_DEFAULT == 125.738, "the rate constant must NOT be re-calibrated here"


# ── The ledger ──────────────────────────────────────────────────────────────────────────────────────
def _run(steps):
    """Drive THE REAL ledger over a (duration, declared, delivered) sequence.

    Frames are given as absolute session seconds on purpose — that is what the device sends, and a
    harness that re-derived them from a step list would be testing its own arithmetic."""
    led = capture.O2PpgFrameLedger()
    rows = [led.frame(*s) for s in steps]
    return led, rows


def test_a_clean_run_counts_no_loss_at_all():
    led, rows = _run([(100, 126, 126), (101, 126, 126), (102, 126, 126)])
    assert (led.frames, led.device_seconds, led.steps_ahead) == (3, 2, 0)
    assert led.truncated == 0
    assert rows[0]["step"] is None, "the first frame closes no step"
    assert [r["step"] for r in rows[1:]] == [1, 1], "the RAW counter step — an ordinary tick is 1"


def test_the_first_frames_connect_backlog_is_excluded_from_the_span():
    """At connect the ring flushes what it accumulated while nobody was listening — 250 samples (~2 s)
    observed on the real probe. No elapsed device-second accounts for it, so counting it would make
    every short session read as a sample SURPLUS."""
    led, _ = _run([(100, 250, 250), (101, 126, 126)])
    assert led.declared == 376, "the connect backlog is still in the honest total"
    assert led.device_seconds == 1, "...but it closes no step, so it buys no device-seconds"


def test_a_duration_step_of_two_is_not_a_missing_frame():
    """THE FINDING, encoded as an assertion. A step of 2 arrives with a normal one-second frame beside
    it — 127 samples, not the ~252 a recovered backlog would carry — so the ledger must count it as a
    counter step and NOT convert it into lost samples.

    The delivered-sample assertion is the point: the samples are all there across the step, so a counter
    that reported "one frame dropped, ~126 samples lost" would be wrong by ~126 every time. On the
    reference night that misreading would have claimed ~20 000 lost samples against the 397 the grid
    actually found."""
    led, rows = _run([(100, 126, 126), (102, 253, 253), (103, 126, 126)])
    assert led.steps_ahead == 1, "the step is recorded..."
    assert led.steps_anomalous == 0
    assert led.device_seconds == 3
    assert rows[1]["step"] == 2, "the RAW step goes in the row, not a derived frames-missing"
    assert led.delivered == 505, "...and the samples are all present: 126 + 253 + 126"


def test_the_step_imbalance_is_the_only_link_reading_the_steps_support():
    """Ahead and flat steps very nearly cancel on a healthy link (159 vs 180 measured). The imbalance is
    the residual, and it is the only quantity here that could carry link information — the raw counts
    carry quantization."""
    led, _ = _run([(100, 126, 126), (102, 252, 252), (102, 0, 0), (103, 126, 126)])
    assert (led.steps_ahead, led.steps_flat) == (1, 1)
    assert led.step_imbalance == 0, "one tick ahead and one flat cancel exactly"


def test_an_anomalous_step_is_counted_apart_from_ordinary_quantization():
    """A step of >= 3 is too large for the poll-vs-tick beat to explain and would warrant a look. Nothing
    in 60.9 h of corpus has produced one; it is counted so the day it happens it is OBSERVED rather than
    reasoned about — the same reason `overflow` counters exist elsewhere in this tree."""
    led, rows = _run([(100, 126, 126), (105, 252, 252)])
    assert led.steps_ahead == 4
    assert led.steps_anomalous == 1, "one anomalous STEP — not one per second it spanned"
    assert rows[1]["step"] == 5


def test_a_flat_step_advances_no_device_time_and_owes_nothing():
    """Two replies inside one ring-second: the counter did not tick. Measured 180x in one night, so the
    row column must be right for them."""
    led, rows = _run([(100, 126, 126), (100, 4, 4), (101, 122, 122)])
    assert led.steps_flat == 1
    assert led.steps_ahead == 0
    assert led.device_seconds == 1
    # NOT -1. An earlier draft returned `step - 1` here — a negative count, written into the sidecar on
    # every one of a night's 180 flat steps. The bug this assertion caught.
    assert rows[1]["step"] == 0, "a zero-second step is recorded as 0, not as -1"


def test_a_session_restart_breaks_the_span_instead_of_fabricating_one():
    """The ring's counter going backwards is a NEW recording session. The wall time between the two
    sessions is in neither counter, so attributing seconds — or missing frames — across it would invent
    both. The row's step columns go blank for the same reason."""
    led, rows = _run([(900, 126, 126), (901, 126, 126), (0, 126, 126), (1, 126, 126)])
    assert led.restarts == 1
    assert led.steps_ahead == 0, "a restart is not a 900-second counter jump"
    assert led.device_seconds == 2, "one step before the restart, one after — not the 900 between"
    assert rows[2]["step"] is None
    assert rows[2]["n"] == 126, "the declared count is still a fact across a restart"


def test_truncation_is_counted_and_is_independent_of_the_duration_steps():
    """`declared - delivered` is bytes going missing between the ring and the decoder. It is the ONLY
    counter here whose being non-zero means something actually broke — it needs no constant and, unlike
    the duration steps, it cannot be produced by the ring's counter quantizing."""
    led, _ = _run([(100, 126, 126), (101, 126, 60), (102, 126, 126)])
    assert led.truncated == 66
    assert led.steps_ahead == 0
    assert led.declared == 378 and led.delivered == 312




def test_an_empty_ledger_reports_nothing_rather_than_a_clean_bill():
    """A session that decoded no frame must not read as zero loss over zero seconds and be logged as
    healthy — the capture path gates its report on `device_seconds` for this reason."""
    led = capture.O2PpgFrameLedger()
    assert (led.frames, led.device_seconds, led.declared, led.truncated) == (0, 0, 0, 0)


# ── The report ──────────────────────────────────────────────────────────────────────────────────────
# There is deliberately NO test here that rebuilds the session-end log line and asserts against its own
# copy of the format string. That is the failure `test_o2ring_ppg_gap.py`'s header records — "two copies
# of the rule, with the assertions pointed at the copy that ships to nobody" — and a first draft of this
# file had exactly it. The shipped line is driven end-to-end instead, by
# `test_capture_runners.py::test_run_oxyii_reports_the_ppg_frame_ledger_at_session_end`, which advances
# the ring's session second (the sibling PPG runner test holds it CONSTANT, so `device_seconds` never
# moves and the report never executes) and asserts the real wording, "quantization — not lost frames".




# ── The step-quantization model (FOLLOWUPS §2) ──────────────────────────────────────────────────────
def test_model_predicts_pure_drift_as_backward_wraps_only():
    """The ring's counter is `floor(t / ring + phase)`. With NO jitter and a poll interval slightly
    SHORTER than the ring second, the phase only ever slips backwards — so every non-unit step is a 0
    and there are no 2s. 1000 polls at 999.34 ms against a 1000 ms ring second slip 0.66 of a cycle."""
    r = capture.predict_step_split([999.34] * 1000, 1000.0)
    assert abs(r["n0"] - 0.66) < 0.01, r
    assert r["n2"] == 0.0, "a consistently short poll cannot wrap the phase FORWARD"


def test_model_predicts_symmetric_jitter_as_equal_counts():
    """Jitter with zero mean adds wraps in PAIRS — every forward excursion is undone — so it moves n0
    and n2 together and leaves their DIFFERENCE alone. That difference is what the drift sets."""
    r = capture.predict_step_split([990.0, 1010.0] * 500, 1000.0)
    assert abs(r["n0"] - 5.0) < 1e-9 and abs(r["n2"] - 5.0) < 1e-9, r
    assert abs(r["n0"] - r["n2"]) < 1e-9, "zero-mean jitter must not bias the difference"


def test_model_OVER_predicts_when_the_interval_is_measured_with_noise():
    """THE ASSERTION THAT EXPLAINS THE 1.85x, and the reason this function ships as a BOUND.

    `E[eps+]` is convex, so independent noise on the measured interval can only INCREASE it. The sidecar
    records HOST ARRIVAL times while the ring samples its counter when it builds the reply, so the
    measured interval carries BLE delivery jitter the ring never saw — and the prediction inflates.
    Measured over 66 clean sessions: median 1.85x too high (IQR 1.46-2.21); re-measured 2026-08-04 over
    the whole 220-sidecar box corpus (62 sessions, 324,073 intervals) at 1.24x flat / 1.45x double,
    pooled 1.31x, median per session 1.64x.

    That the cause is DELIVERY JITTER rather than a modelling error is no longer a hypothesis: the excess
    vanishes monotonically under running-median smoothing of the host stamps and crosses 1.00 at width ~2,
    which places it at the adjacent-sample scale — real clock divergence is the low-frequency part and
    would survive. A phase-accumulator variant, the obvious rival explanation, is WORSE (1.35x/1.63x).
    See O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2.1a. Do NOT scale the output by any of these numbers, and do
    NOT pick a smoothing width by the ratio it produces — signal and noise share a band here.

    If someone later 'fixes' the over-prediction by scaling the output, this still holds and the scale
    factor is revealed as the fudge it would be — the defect is in the INPUT, not the formula."""
    clean = [1000.0, 1000.0, 999.0, 1001.0] * 250
    noisy = [v + (12.0 if i % 2 else -12.0) for i, v in enumerate(clean)]
    c = capture.predict_step_split(clean, 1000.0)
    n = capture.predict_step_split(noisy, 1000.0)
    assert n["n2"] > c["n2"], f"noise must inflate the forward-wrap prediction: {c} -> {n}"
    assert n["n0"] > c["n0"], f"...and the backward one: {c} -> {n}"
    # the difference is what the drift sets, so noise must NOT move it
    assert abs((n["n0"] - n["n2"]) - (c["n0"] - c["n2"])) < 1e-9, "noise moved the DIFFERENCE — it must not"


def test_model_refuses_rather_than_guessing():
    for bad in ([], [None, float("nan")]):
        r = capture.predict_step_split(bad, 1000.0)
        assert r["n0"] != r["n0"], f"no usable intervals must give NaN, got {r}"
    r = capture.predict_step_split([1000.0] * 10, 0)
    assert r["n0"] != r["n0"], "a non-positive ring second must give NaN, not a division"
