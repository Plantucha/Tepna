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
import pytest

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
def _run(steps, nominal=oxyii.PPG_FRAME_SAMPLES):
    """Drive THE REAL ledger over a (duration, declared, delivered) sequence.

    Frames are given as absolute session seconds on purpose — that is what the device sends, and a
    harness that re-derived them from a step list would be testing its own arithmetic."""
    led = capture.O2PpgFrameLedger(nominal=nominal)
    rows = [led.frame(*s) for s in steps]
    return led, rows


def test_a_clean_run_counts_no_loss_at_all():
    led, rows = _run([(100, 126, 126), (101, 126, 126), (102, 126, 126)])
    assert (led.frames, led.device_seconds, led.steps_ahead) == (3, 2, 0)
    assert led.truncated == 0
    assert led.counted_loss == 0, "126/s declared against 126/s expected must net exactly zero"
    assert rows[0]["step"] is None, "the first frame closes no step"
    assert [r["step"] for r in rows[1:]] == [1, 1], "the RAW counter step — an ordinary tick is 1"
    assert [r["expected"] for r in rows[1:]] == [126, 126]


def test_the_first_frames_connect_backlog_is_excluded_from_the_span():
    """At connect the ring flushes what it accumulated while nobody was listening — 250 samples (~2 s)
    observed on the real probe. No elapsed device-second accounts for it, so counting it would make
    every short session read as a sample SURPLUS."""
    led, _ = _run([(100, 250, 250), (101, 126, 126)])
    assert led.declared == 376, "the honest total still includes it"
    assert led.span_declared == 126, "the ARITHMETIC window does not"
    assert led.device_seconds == 1
    assert led.counted_loss == 0


def test_a_duration_step_of_two_is_not_a_missing_frame():
    """THE FINDING, encoded as an assertion. A step of 2 arrives with a normal one-second frame beside
    it — 127 samples, not the ~252 a recovered backlog would carry — so the ledger must count it as a
    counter step and NOT convert it into lost samples.

    The `counted_loss == 0` here is the whole point: it is what makes a counter that reported "one frame
    dropped, ~126 samples lost" fail. On the reference night that misreading would have claimed ~20 000
    lost samples against the 397 the grid actually found."""
    led, rows = _run([(100, 126, 126), (102, 253, 253), (103, 126, 126)])
    assert led.steps_ahead == 1, "the step is recorded..."
    assert led.steps_anomalous == 0
    assert led.device_seconds == 3
    assert rows[1]["step"] == 2, "the RAW step goes in the row, not a derived frames-missing"
    assert rows[1]["expected"] == 252
    assert led.counted_loss == -1, "...and it cost no samples: one extra tick, one extra sample"


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
    assert led.counted_loss == 378


def test_a_flat_step_advances_no_device_time_and_owes_nothing():
    """Two replies inside one ring-second: the counter did not tick. Measured 180x in one night, so the
    row column must be right for them."""
    led, rows = _run([(100, 126, 126), (100, 4, 4), (101, 122, 122)])
    assert led.steps_flat == 1
    assert led.steps_ahead == 0
    assert led.device_seconds == 1
    # NOT -1. An earlier draft returned `step - 1` here — a negative count, written into the sidecar on
    # every one of a night's 180 flat steps. The bug this assertion caught.
    assert rows[1]["step"] == 0 and rows[1]["expected"] == 0, "a zero-second step owes nothing"
    assert led.counted_loss == 0, "the split second's samples still total one second's worth"


def test_a_session_restart_breaks_the_span_instead_of_fabricating_one():
    """The ring's counter going backwards is a NEW recording session. The wall time between the two
    sessions is in neither counter, so attributing seconds — or missing frames — across it would invent
    both. The row's step columns go blank for the same reason."""
    led, rows = _run([(900, 126, 126), (901, 126, 126), (0, 126, 126), (1, 126, 126)])
    assert led.restarts == 1
    assert led.steps_ahead == 0, "a restart is not a 900-second counter jump"
    assert led.device_seconds == 2, "one step before the restart, one after — not the 900 between"
    assert rows[2]["step"] is None and rows[2]["expected"] is None
    assert rows[2]["n"] == 126, "the declared count is still a fact across a restart"


def test_truncation_is_counted_and_is_independent_of_the_duration_steps():
    """`declared - delivered` is bytes going missing between the ring and the decoder. It is the ONLY
    counter here whose being non-zero means something actually broke — it needs no constant and, unlike
    the duration steps, it cannot be produced by the ring's counter quantizing."""
    led, _ = _run([(100, 126, 126), (101, 126, 60), (102, 126, 126)])
    assert led.truncated == 66
    assert led.steps_ahead == 0
    assert led.declared == 378 and led.delivered == 312


def test_counted_loss_is_signed_and_goes_negative_on_a_clean_night():
    """Real delivery is 126.04 per device-second against a nominal 126, so the subtraction lands
    NEGATIVE on a clean run (~-7 800 reconstructed on 2026-08-01). Pinned as a PROPERTY, not tolerated
    as a quirk: clamping it at zero would hide exactly the bias that makes `truncated` — which uses no
    constant at all — the one to trust."""
    led, _ = _run([(100, 126, 126)] + [(100 + i, 127, 127) for i in range(1, 11)])
    assert led.counted_loss < 0
    assert led.counted_loss == 126 * 10 - 127 * 10


def test_expected_tracks_device_seconds_at_the_configured_nominal():
    led, _ = _run([(100, 100, 100), (101, 100, 100), (103, 100, 100)], nominal=100)
    assert led.nominal == 100
    assert led.device_seconds == 3
    assert led.expected == 300
    assert led.counted_loss == 100, "one frame's worth was owed and never declared"


def test_an_empty_ledger_reports_nothing_rather_than_a_clean_bill():
    """A session that decoded no frame must not read as zero loss over zero seconds and be logged as
    healthy — the capture path gates its report on `device_seconds` for this reason."""
    led = capture.O2PpgFrameLedger()
    assert (led.frames, led.device_seconds, led.expected, led.counted_loss) == (0, 0, 0, 0)


# ── The report ──────────────────────────────────────────────────────────────────────────────────────
# There is deliberately NO test here that rebuilds the session-end log line and asserts against its own
# copy of the format string. That is the failure `test_o2ring_ppg_gap.py`'s header records — "two copies
# of the rule, with the assertions pointed at the copy that ships to nobody" — and a first draft of this
# file had exactly it. The shipped line is driven end-to-end instead, by
# `test_capture_runners.py::test_run_oxyii_reports_the_ppg_frame_ledger_at_session_end`, which advances
# the ring's session second (the sibling PPG runner test holds it CONSTANT, so `device_seconds` never
# moves and the report never executes) and asserts the real wording, "quantization — not lost frames".


@pytest.mark.parametrize("nominal", [126, 125, 130])
def test_the_nominal_is_a_parameter_not_a_hardcode(nominal):
    """Another unit will not deliver 126/s — the constant is validated on ONE ring (S8-AW 2100)."""
    led, _ = _run([(0, nominal, nominal), (1, nominal, nominal)], nominal=nominal)
    assert led.counted_loss == 0
