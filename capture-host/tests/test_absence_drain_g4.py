# tepna-capture — tests/test_absence_drain_g4.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ABSENCE-SURVEY drain, group 4 (device paths): plants that drive the production loop."""

import capture
import oxyii
import test_capture_runners as T

_clean_stop = T._clean_stop


def _live_reply_contact(contact: int, duration=900):
    hdr = bytearray(24)
    hdr[5] = contact  # byte [5] sensorState: 0 lead-off · 1 normal · 2 probe unplugged · 3 fault
    hdr[6] = 0  # a probe that cannot look delivers no SpO2 (parse_live: outside 50..100 -> None)
    hdr[7] = 14
    hdr[8] = 55
    hdr[10] = 0x01
    hdr[13] = 90
    hdr[0:4] = int(duration).to_bytes(4, "little")
    return oxyii.encode(oxyii.OP_LIVE, bytes(hdr))


def test_a_FAULTED_probe_is_wear_UNKNOWN_and_journals_no_unworn_flip(tmp_path, monkeypatch):
    """PLANT cff33c90fd16: `worn = contact == 1` made a probe that could not look (2 unplugged, 3 fault) read
    as a bare finger — the link axis journaled IDLE_UNWORN and the card said "no finger contact". The sensor
    reported a fault, so wear is unknown: no flip on the link axis, `worn` None, and the reason says so.

    The frame carries NO SpO2, as a probe that cannot look delivers none: a frame WITH vitals takes the
    vitals branch, which infers worn from the vitals themselves and is not what this finding is about."""
    capture._OXYII_PAUSE.clear()
    capture._RECOVER.clear()
    capture._OXYII_RTC_AT.clear()
    replies = [_live_reply_contact(3) for _ in range(5)]
    c = T.FakeGattClient()
    c.on_live = lambda data: c.notify(0, replies.pop(0)) if data[1] == oxyii.OP_LIVE and replies else None
    T._inject_connect_scan(monkeypatch, c)
    T._stop_after(monkeypatch, 8)
    T._run(capture.run_oxyii(T._o2dev(), str(tmp_path)))
    link = [r[3] for r in T._oxylife_link_rows(tmp_path)]
    assert "idle_unworn" not in link, f"a probe fault was journaled as an unworn ring: {link}"
    st = capture.STATUS["devices"]["Ring"]
    assert st.get("worn") is None, st.get("worn")
    assert "fault" in (st.get("last_error") or "") and "unknown" in st["last_error"], st.get("last_error")


# ── absence drain group 4a: the diff-scoped survivors in EdfSink / parse_live ────────────────────────


def test_the_EDF_sink_names_WHICH_channel_a_skipped_batch_carried_and_counts_them(tmp_path, caplog):
    import logging

    import cpap_edf_writer as W

    sink = W.EdfSink(str(tmp_path / "x"), "SER")
    sink.open({}, 25.0)
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        sink.on_batch({"start_time": "2026-08-23T22:15:03.000Z", "interval_ms": 40, "channels": {"PatientFlow": [0.1]}})
        sink.on_batch(
            {"start_time": "2026-08-23T22:15:04.000Z", "interval_ms": 40, "channels": {"MaskPressure": [5.0]}}
        )
    msgs = [r.getMessage() for r in caplog.records if "batch carried" in r.getMessage()]
    assert msgs == [
        "CPAP EDF sink: a batch carried flow but not pressure — skipped for both so the channels stay aligned "
        "(1 unpaired batch(es) so far)",
        "CPAP EDF sink: a batch carried pressure but not flow — skipped for both so the channels stay aligned "
        "(2 unpaired batch(es) so far)",
    ], msgs


def test_the_EDF_sink_warns_in_full_when_the_device_interval_is_not_25_Hz(tmp_path, caplog):
    import logging

    import cpap_edf_writer as W

    sink = W.EdfSink(str(tmp_path / "x"), "SER")
    sink.open({}, 25.0)
    b = {
        "start_time": "2026-08-23T22:15:03.000Z",
        "interval_ms": 20,
        "channels": {"PatientFlow": [0.1], "MaskPressure": [5.0]},
    }
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        sink.on_batch(b)
    msgs = [r.getMessage() for r in caplog.records if "observed interval" in r.getMessage()]
    assert msgs == [
        "CPAP EDF sink: observed interval 20 ms != the BRP 25 Hz rate (40 ms) — the EDF is built at 25 Hz, "
        "so its timing will not match the stream"
    ], msgs


def test_alarm_raw_is_read_from_a_frame_of_EXACTLY_15_bytes():
    """`len(payload) > 14`: byte [14] exists in a 15-byte frame. `> 15` would call it absent."""
    b = bytearray(15)
    b[5], b[6], b[14] = 1, 96, 0x5A
    assert oxyii.parse_live(bytes(b))["alarm_raw"] == 0x5A
