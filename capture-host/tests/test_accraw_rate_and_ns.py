# tepna-capture — tests/test_accraw_rate_and_ns.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The ACCRAW defect pair, which are one unit because fixing either alone leaves the other masked.
#
#   (a) The ring's ACC is a ZERO-ORDER HOLD: it MEASURES at 1.5625 Hz while the capture path writes
#       ~9.979 Hz records, so ~84 % of records repeat the previous value. A consumer computing
#       independent samples, an epoch grid or information content from the record count is 6.4x wrong.
#   (b) Three raw-buffer opcodes carry no device clock and wrote a literal `0` in the ns column. `0`
#       is IN-BAND for a nanosecond counter, so absence read as the instant zero.
#
# Every test here plants the defect and asserts the test RED-s on it, because both failures produced
# well-formed output: a plausible rate and a plausible timestamp. Nothing looked wrong either way.

import datetime as _dt

import nightqc
import writers
from writers import StreamWriter, _ns_col

T0 = _dt.datetime(2026, 9, 6, 4, 53, 0)


def _rows(path):
    return [ln.split(";") for ln in open(path).read().splitlines()
            if ln and not ln.startswith("#") and not ln.startswith("Phone")]


# ── (b) absence in the ns column is written as absence ────────────────────────────────────────

def test_a_stream_with_no_device_clock_writes_the_ns_column_BLANK_not_zero():
    """`0` cannot be told apart from a device that reported the instant zero. Blank is out-of-band:
    `int('')` raises, so every reader parses it as absent rather than as the epoch."""
    assert _ns_col(None) == ""
    assert _ns_col(0) == "0"          # a REAL zero from a device still writes as zero
    assert _ns_col(1234) == "1234"


def test_all_three_raw_buffer_writers_emit_an_empty_ns_field(tmp_path):
    """Measured on one real session before the fix: ACCRAW 15120/15120, PLETHA 583/583,
    PPG2W 303109/303109 rows at exactly 0 — while `PPG.txt` was 1/190100 and H10 `ECG.txt` 0/214693
    on the same night, so it is these opcodes and not the night."""
    for stream, call in (
        ("accraw", lambda w: w.write_acc(T0, None, 0.0, 1, 2, 3)),
        ("pletha", lambda w: w.write_pletha(T0, None, 7, 0)),
        ("ppg2w", lambda w: w.write_ppg2w(T0, None, 11, 22, 3)),
    ):
        p = tmp_path / f"X_{stream.upper()}.txt"
        w = StreamWriter(str(p), stream, fsync=False)
        call(w)
        w.close()
        row = _rows(p)[0]
        assert row[1] == "", f"{stream}: ns column is {row[1]!r}, not absent"


def test_a_stream_that_HAS_a_device_clock_is_untouched(tmp_path):
    """The fix must not reach the streams whose ns column is a real measurement — `write_ppg` passes
    the device's own value and keeps doing so."""
    p = tmp_path / "X_PPG.txt"
    w = StreamWriter(str(p), "ppg1", fsync=False)
    w.write_ppg(T0, 987654321, 0.0, (5,), 0)
    w.close()
    assert _rows(p)[0][1] == "987654321"


# ── (b) the consequence: a span of zero is not a duration ─────────────────────────────────────

def _write_ns_file(path, ns_values):
    with open(path, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];X [raw];Y [raw];Z [raw]\n")
        for i, ns in enumerate(ns_values):
            fh.write(f"2026-09-06T04:53:0{i % 10}.000;{ns};1;2;3\n")


def test_a_column_that_never_moved_reports_UNKNOWN_span_not_a_zero_one(tmp_path):
    """This is the masked half. `file_span_sec` returned a REAL 0.0 for an all-zero column — a
    measurement of no elapsed time — and every consumer landed in "unknown" only because 0.0 happens
    to be falsy. The moment one of them stopped using `or`, a legacy file would have contributed a
    zero-second span as if measured. Legacy files keep their literal zeros forever, so this guard
    outlives the writer fix."""
    p = tmp_path / "legacy_ACCRAW.txt"
    _write_ns_file(p, [0] * 50)
    assert nightqc.file_span_sec(str(p)) is None


def test_a_blank_column_also_reports_unknown(tmp_path):
    p = tmp_path / "new_ACCRAW.txt"
    _write_ns_file(p, [""] * 50)
    assert nightqc.file_span_sec(str(p)) is None


def test_a_real_span_is_still_measured(tmp_path):
    """The null control: the guard must not swallow a genuine duration."""
    p = tmp_path / "real_ACC.txt"
    _write_ns_file(p, [i * 100_000_000 for i in range(50)])
    assert nightqc.file_span_sec(str(p)) == 4.9


def test_the_weighting_caller_separates_UNKNOWN_from_ZERO(tmp_path):
    """`file_span_sec`'s contract says callers must treat None as unknown, never as zero; the night
    weighting did `float(span or 0.0)`, which collapses them. Same arm today — an unplaceable file is
    a point at its start stamp either way — but the distinction is kept so the idiom is not copied."""
    src = open(nightqc.__file__).read()
    assert 'float(f.get("span_sec") or 0.0)' not in src, "the collapsing idiom is back"
    assert 'raw = f.get("span_sec")' in src


# ── (a) two rates, and they answer different questions ────────────────────────────────────────

RING = {"model": "O2Ring-S", "name": "Wellue O2Ring-S", "streams": ["spo2", "ppg", "acc"]}


def test_the_ring_declares_a_record_rate_AND_a_measurement_rate_and_they_differ():
    """The whole defect in one assertion: ~6.4 records per measurement. Measured over two nights —
    record rate 9.979-10.000 Hz, distinct-value rate 1.562-1.565 Hz, 6.387-6.396 records per distinct
    value (= 32/5)."""
    rec = nightqc._expected_hz(RING, "acc")
    meas = nightqc.measurement_hz(RING, "acc")
    assert rec is not None and meas is not None
    assert 6.38 <= rec / meas <= 6.40, f"{rec}/{meas} = {rec / meas}"


def test_coverage_is_judged_against_the_RECORD_rate(tmp_path):
    """`measured_hz` reads ROWS off the file and `_expected_hz` is what it is compared against, so a
    denominator that is not the row rate reports a healthy stream as mismatched — convicting the
    device for working as designed. The O2Ring `ppg` entry above already encodes this reasoning."""
    assert nightqc._expected_hz(RING, "acc") > 9.0


def test_a_stream_with_no_separate_measurement_rate_reports_None():
    """None means "the record rate IS the measurement rate", not "unknown, assume something"."""
    assert nightqc.measurement_hz(RING, "ppg") is None
    assert nightqc.measurement_hz(RING, "spo2") is None


def test_an_unrecognised_device_borrows_neither_rate():
    """A rate borrowed from a model this device is not is a fabricated reference."""
    other = {"model": "SomeOtherRing", "name": "unknown", "streams": ["acc"]}
    assert nightqc.measurement_hz(other, "acc") is None


def test_a_device_may_override_the_measurement_rate_in_its_own_config():
    dev = dict(RING, measurement_rates={"acc": 3.125})
    assert nightqc.measurement_hz(dev, "acc") == 3.125


def test_the_two_tables_are_separate_objects_not_aliases():
    """Conflating them is the defect. If one table ever supplies both answers, this red-s."""
    assert nightqc._NOMINAL_HZ["O2Ring"]["acc"] != nightqc._MEASUREMENT_HZ["O2Ring"]["acc"]
    assert "acc" in nightqc._MEASUREMENT_HZ["O2Ring"]
    assert set(nightqc._MEASUREMENT_HZ["O2Ring"]) - set(nightqc._NOMINAL_HZ["O2Ring"]) == set()


def test_the_held_repeats_are_NOT_recorded_as_absence(tmp_path):
    """The ring's ACC repeats each value 6-7x BY DESIGN — a drawn axis (Clock Contract §7), real data
    at a real lower rate, not the §∅ absence shape. The run-length sidecar must not flag it: 99.8 % of
    its runs are length 6 or 7, so a constant-run rule would convict the whole file."""
    p = tmp_path / "R_ACCRAW.txt"
    w = StreamWriter(str(p), "accraw", fsync=False)
    for r in range(writers.HELD_WARMUP_RUNS + 5):        # 6/7-length runs, as measured
        for k in range(6 + (r % 2)):
            w.write_acc(T0 + _dt.timedelta(milliseconds=100 * (r * 7 + k)), None, 0.0, r, r, r)
    w.close()

    sidecar = str(p).rpartition(".")[0] + "RUNS.txt"
    body = open(sidecar).read()
    assert "class=held" in body, "the zero-order hold was not recognised"
    assert _rows(sidecar) == [], "the device's own sampling cadence was reported as absence"
