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
