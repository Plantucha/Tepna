# tepna-capture — tests/test_cpap_edf_writer.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""EdfSink — the live BLE StreamData → BRP.edf-on-disk sink.

The two invariants worth their own tests are QUARANTINE (an unpinned-flow-scale file must not land where
the harvest/CPAPDex chain ingests it as therapy data) and the device-clock start (verbatim, never
host-corrected or fabricated). The rest pins the accumulate→build→atomic-write path against the
byte-accurate cpap_edf builder proven in #1669.
"""

import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cpap_edf  # noqa: E402
import cpap_edf_writer as W  # noqa: E402
import pytest  # noqa: E402

SERIAL = "23211234567"


@pytest.fixture(autouse=True)
def _tz_guard():
    """Restore the process timezone after any test that sets TZ — monkeypatch restores the env var but not
    the C library's tzset() state, which would otherwise leak into a later zoned-stamp test."""
    orig = os.environ.get("TZ")
    yield
    if orig is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = orig
    time.tzset()


def _batch(start, flow, press):
    return {"start_time": start, "interval_ms": 40,
            "channels": {"PatientFlow": list(flow), "MaskPressure": list(press)}}


def _run(sink, n_seconds, start="2026-08-23T22:15:03", flow=0.1, press=5.0):
    """Feed `n_seconds` of 25 Hz batches (one batch = one second = 25 samples) and close."""
    sink.open({"PatientFlow": None, "MaskPressure": None}, 25.0)
    for _ in range(n_seconds):
        sink.on_batch(_batch(start, [flow] * 25, [press] * 25))
    sink.close()


# ── QUARANTINE ────────────────────────────────────────────────────────────────────────────────────────
def test_an_UNVERIFIED_flow_scale_is_QUARANTINED_outside_the_ingest_root(tmp_path):
    """⚠️ THE BINDING INVARIANT. The StreamData PatientFlow physical scale (L/s vs L/min) is not yet
    pinned, and a 60x-off flow that still parses cleanly is the 'valid-looking file, wrong data' class
    this repo keeps paying for. So the DEFAULT (flow_scale_verified False) writes under a PENDING subtree
    that is NOT under the harvest ingest root — CPAPDex cannot read it as therapy data."""
    out = tmp_path / "cpap-ble"
    sink = W.EdfSink(str(out), SERIAL)                  # default: unverified
    _run(sink, 61)
    assert os.path.sep + W.EdfSink.PENDING + os.path.sep in sink.path, "must be under PENDING"
    ingest_root = str(tmp_path / "captures" / "cpap")   # where the SD-card harvest lands
    assert not sink.path.startswith(ingest_root), "an unpinned file must not enter the ingest set"
    assert os.path.exists(sink.path)


def test_a_VERIFIED_flow_scale_writes_to_the_committed_root_not_PENDING(tmp_path):
    """The mirror image: once the factor is pinned, flow_scale_verified True routes to the committed root,
    so the quarantine is a gate that actually opens rather than a permanent detour."""
    out = tmp_path / "cpap-ble"
    sink = W.EdfSink(str(out), SERIAL, flow_scale_verified=True)
    _run(sink, 61)
    assert os.path.sep + W.EdfSink.PENDING + os.path.sep not in sink.path
    assert sink.path.startswith(str(out))


def test_unverified_is_the_DEFAULT(tmp_path):
    """A caller that forgets the flag gets the SAFE behavior — the quarantine is opt-out, not opt-in."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    assert sink._verified is False


# ── DEVICE CLOCK (verbatim, validated, never fabricated) ────────────────────────────────────────────────
def test_an_UNZONED_device_stamp_is_taken_verbatim(tmp_path):
    """An unzoned stamp is already floating LOCAL civil (the zone-free convention the SD-card BRP.edf uses),
    so it is written verbatim — no timezone conversion."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    _run(sink, 2, start="2026-01-05T03:07:09")
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    assert edf.startdate == "05.01.26" and edf.starttime == "03.07.09"
    assert sink.path.endswith("20260105_030709_BRP.edf")


def test_a_ZONED_UTC_stamp_is_RESOLVED_to_local_civil(tmp_path, monkeypatch):
    """⚠️ THE CLOCK FIX (2026-08-23). The device's live StreamData stamp is UTC ('…Z'), but the SD card and
    OSCAR use local civil — writing UTC verbatim mis-dates the EDF by the offset (measured: 4 h EDT). A
    zoned stamp is converted to the box's local civil time. TZ pinned to UTC-5 → 18:47:42Z becomes 13:47:42."""
    monkeypatch.setenv("TZ", "XXX5")   # POSIX: std name XXX, 5 h WEST of UTC (fixed, no DST)
    time.tzset()
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    _run(sink, 2, start="2026-08-23T18:47:42.000Z")
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    assert edf.starttime == "13.47.42", "18:47:42 UTC rendered in UTC-5 local civil"
    assert edf.startdate == "23.08.26"
    assert sink.path.endswith("20260823_134742_BRP.edf")


def test_a_ZONED_offset_stamp_is_also_resolved_to_local(tmp_path, monkeypatch):
    """A ±HH:MM offset is a real instant too, resolved the same way: 20:47:42+02:00 = 18:47:42 UTC =
    13:47:42 in UTC-5."""
    monkeypatch.setenv("TZ", "XXX5")
    time.tzset()
    assert W._start_components("2026-08-23T20:47:42+02:00") == (2026, 8, 23, 13, 47, 42)


def test_Z_stamp_in_UTC_timezone_is_a_noop_conversion(tmp_path, monkeypatch):
    """The conversion degenerates cleanly: a Z stamp with the box itself on UTC keeps its components."""
    monkeypatch.setenv("TZ", "UTC0")
    time.tzset()
    assert W._start_components("2026-08-23T18:47:42Z") == (2026, 8, 23, 18, 47, 42)


def test_an_unparseable_start_REFUSES_rather_than_fabricating_a_date(tmp_path):
    """Clock Contract §2.6 — a missing/garbage stamp is null, never now(). The sink raises rather than
    dating the night with the host clock."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    with pytest.raises(ValueError, match="unparseable"):
        sink.on_batch(_batch("not-a-timestamp", [0.1] * 25, [5.0] * 25))


def test_a_missing_start_time_is_refused_not_dated_from_the_host(tmp_path):
    """A batch with no start_time at all (None) is the same honesty case as a garbage one — refuse,
    never fall back to the host clock."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    with pytest.raises(ValueError, match="unparseable"):
        sink.on_batch({"interval_ms": 40, "channels": {"PatientFlow": [0.1] * 25}})


def test_an_out_of_range_stamp_is_refused_not_silently_rolled(tmp_path):
    """§2.7 — Date-style rolling (month 13 → next Jan) fabricates a wrong instant. A calendar-invalid
    stamp is refused."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    with pytest.raises(ValueError):
        sink.on_batch(_batch("2026-02-30T25:99:00.000Z", [0.1] * 25, [5.0] * 25))


def test_24_00_00_end_of_day_rolls_to_next_day(monkeypatch):
    """The one legal ISO overflow (§2.7): 24:00:00 → 00:00:00 the next calendar day, applied BEFORE the
    timezone resolution (TZ=UTC here so the conversion is a no-op and the roll is what's under test)."""
    monkeypatch.setenv("TZ", "UTC0")
    time.tzset()
    assert W._start_components("2026-08-23T24:00:00Z") == (2026, 8, 24, 0, 0, 0)


# ── §2 OBSERVED INTERVAL (the device's OWN interval_ms, validated once) ─────────────────────────────────
def _batch_iv(start, iv, flow=0.1, press=5.0):
    """A one-second batch carrying an explicit interval_ms (the device's OWN reported rate). iv=None omits
    the field entirely — the shape as11_pull yields when a StreamData notification has no intervalMs."""
    b = _batch(start, [flow] * 25, [press] * 25)
    if iv is None:
        b.pop("interval_ms")
    else:
        b["interval_ms"] = iv
    return b


def test_an_off_rate_interval_warns_ONCE_not_per_batch(tmp_path, caplog):
    """§2 — the device reports its own interval_ms per batch; the EDF is built at a FIXED 25 Hz (40 ms), so
    an observed interval other than 40 ms means the file's timing will not match the stream. That is warned
    exactly ONCE, on the first batch that carries a valid interval — never once per batch across a whole
    night — and the check latches so it costs nothing thereafter."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        for _ in range(3):
            sink.on_batch(_batch_iv("2026-08-23T22:15:03", 20))   # 20 ms = 50 Hz, off the BRP 25 Hz rate
        sink.close()
    warns = [r for r in caplog.records if "observed interval" in r.getMessage()]
    assert len(warns) == 1, "the off-rate interval is warned once, not per batch"
    assert sink._interval_checked is True


def test_a_batch_without_interval_ms_skips_the_check_and_still_writes(tmp_path, caplog):
    """§2 — a batch that omits interval_ms carries no rate to validate; the check is simply skipped (it stays
    unchecked, no warning) and the capture proceeds. Absence of the field is not an error."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        for _ in range(61):
            sink.on_batch(_batch_iv("2026-08-23T22:15:03", None))
        sink.close()
    assert sink._interval_checked is False, "no interval_ms ever seen → nothing validated"
    assert not [r for r in caplog.records if "observed interval" in r.getMessage()]
    assert os.path.exists(sink.path)


def test_the_expected_40ms_interval_is_silent(tmp_path, caplog):
    """§2 — the happy path: the device reports the expected 40 ms, so nothing is warned. (The default
    _batch already carries interval_ms=40; this pins the silence explicitly.)"""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        _run(sink, 2, start="2026-08-23T22:15:03")
    assert sink._interval_checked is True
    assert not [r for r in caplog.records if "observed interval" in r.getMessage()]


def test_a_zero_interval_is_treated_as_no_valid_interval(tmp_path, caplog):
    """§2 boundary — interval_ms=0 is not a valid rate (0 Hz), so `iv > 0` rejects it: the check stays
    unrun (no fabricated 0 vs 40 warn) exactly as an absent interval would. Pins the `> 0` lower bound —
    a `>= 0` would accept 0 and warn spuriously."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        for _ in range(3):
            sink.on_batch(_batch_iv("2026-08-23T22:15:03", 0))
        sink.close()
    assert sink._interval_checked is False, "0 ms is not a valid interval — nothing validated"
    assert not [r for r in caplog.records if "observed interval" in r.getMessage()]


def test_a_one_ms_interval_still_warns_as_off_rate(tmp_path, caplog):
    """§2 boundary — interval_ms=1 IS a positive, valid interval (just wildly off the 40 ms BRP rate), so
    `iv > 0` accepts it and it warns. Pins that the bound is `> 0`, not `> 1`: a `> 1` would silently skip
    a 1 ms observation."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        sink.on_batch(_batch_iv("2026-08-23T22:15:03", 1))
        sink.close()
    warns = [r for r in caplog.records if "observed interval" in r.getMessage()]
    assert len(warns) == 1 and sink._interval_checked is True


def test_the_warn_names_both_the_observed_and_expected_interval(tmp_path, caplog):
    """§2 — the warning must carry BOTH the observed interval AND the expected 40 ms, so an operator reading
    it knows the actual vs the assumed. Pins both format args: a mutant dropping either (logging `None`)
    is caught."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        sink.on_batch(_batch_iv("2026-08-23T22:15:03", 20))
        sink.close()
    msg = next(r.getMessage() for r in caplog.records if "observed interval" in r.getMessage())
    assert "20" in msg, "the observed interval must appear in the warning"
    assert "40" in msg, "the expected BRP interval must appear in the warning"


def test_the_default_record_length_is_60_seconds(tmp_path):
    """The EdfSink default packs 60 s (1500 samples at 25 Hz) per data record — pinned via the Flow
    signal's samples-per-record so the `record_seconds=60` default cannot drift unseen."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_scale_verified=True)
    _run(sink, 120)
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    assert edf.signals[0].spr == 60 * 25, "default record must hold 60 s of 25 Hz flow (1500 samples)"


# ── ACCUMULATE → BUILD → ATOMIC WRITE ───────────────────────────────────────────────────────────────────
def test_two_batches_produce_a_readable_bit_accurate_BRP(tmp_path):
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    _run(sink, 120)                                    # two whole 60 s records
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    assert [s.label.strip() for s in edf.signals] == ["Flow.40ms", "Press.40ms", "Crc16"]
    assert edf.n_records == 2


def test_the_flow_conversion_is_injectable_and_applied(tmp_path):
    """The unit factor lives at ONE tap. A /60 conversion (the L/min→L/s hypothesis) must reach the
    written physical samples — this is the seam the pinned factor plugs into."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL, flow_to_lps=lambda v: v / 60.0)
    _run(sink, 60, flow=60.0)                          # 60 L/min in → 1.0 L/s stored
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    flow = edf.signals[0]
    # digital→physical round-trip of the first sample; 1.0 L/s within one quantum of the ±2/3 range
    phys = cpap_edf._digital(1.0, -2.0, 3.0, -1000, 1500)
    assert flow.samples[0] == phys


def test_the_final_name_only_appears_after_close_atomic(tmp_path):
    """During capture only a .part exists; the final path is os.replace'd into being on close, so a
    reader never sees a half-written EDF under the real name."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    for _ in range(61):
        sink.on_batch(_batch("2026-08-23T22:15:03.000Z", [0.1] * 25, [5.0] * 25))
    assert os.path.exists(sink.path + ".part"), "the .part carries the in-progress capture"
    assert not os.path.exists(sink.path), "the final name must not exist mid-capture"
    sink.close()
    assert os.path.exists(sink.path) and not os.path.exists(sink.path + ".part")


def test_a_double_close_is_a_noop(tmp_path):
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    _run(sink, 2)
    first = os.path.getmtime(sink.path)
    sink.close()                                       # must not raise or rewrite
    assert os.path.getmtime(sink.path) == first


def test_a_session_that_never_streamed_writes_no_file(tmp_path):
    """A stream that opened but delivered nothing must not leave an empty EDF — no start, no file."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    sink.close()
    assert sink.path is None


def test_a_partial_batch_missing_a_channel_does_not_crash_or_desync(tmp_path):
    """A batch carrying only one channel contributes to that channel alone; the two are padded to equal
    length only at build time, so a dropped channel never shifts flow and pressure out of lockstep."""
    sink = W.EdfSink(str(tmp_path / "x"), SERIAL)
    sink.open({}, 25.0)
    sink.on_batch({"start_time": "2026-08-23T22:15:03.000Z", "interval_ms": 40,
                   "channels": {"PatientFlow": [0.1] * 25}})          # no pressure
    sink.on_batch({"start_time": "2026-08-23T22:15:04.000Z", "interval_ms": 40,
                   "channels": {"MaskPressure": [5.0] * 25}})         # no flow
    sink.close()
    edf = cpap_edf.read_edf(open(sink.path, "rb").read())
    assert edf.n_records == 1                                          # padded to one whole record
