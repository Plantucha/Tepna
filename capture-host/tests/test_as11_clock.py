# tepna-capture — tests/test_as11_clock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Branch coverage for the AS11 clock-discipline analysis: parsing, the offset+rate reduction (including
# the "is a minute a real minute" verdict both ways), and the sidecar writer.

import as11_clock as C


# --- parse_device_epoch_s ---------------------------------------------------------------


def test_parse_iso_monotonic():
    a = C.parse_device_epoch_s("2026-08-24T21:48:55Z")
    b = C.parse_device_epoch_s("2026-08-24T23:34:36.000Z")
    assert a is not None and b is not None
    assert b - a == (23 - 21) * 3600 + (34 - 48) * 60 + (36 - 55)


def test_parse_space_separator():
    assert C.parse_device_epoch_s("2026-08-24 23:34:36") is not None


def test_parse_none_for_non_string():
    assert C.parse_device_epoch_s(None) is None
    assert C.parse_device_epoch_s(1234) is None


def test_parse_none_for_unmatched():
    assert C.parse_device_epoch_s("garbage") is None


def test_parse_rejects_bad_month_day():
    assert C.parse_device_epoch_s("2026-00-10T00:00:00Z") is None
    assert C.parse_device_epoch_s("2026-13-10T00:00:00Z") is None
    assert C.parse_device_epoch_s("2026-08-00T00:00:00Z") is None
    assert C.parse_device_epoch_s("2026-08-32T00:00:00Z") is None


def test_parse_rejects_bad_time():
    assert C.parse_device_epoch_s("2026-08-24T24:00:00Z") is None
    assert C.parse_device_epoch_s("2026-08-24T00:60:00Z") is None
    assert C.parse_device_epoch_s("2026-08-24T00:00:60Z") is None


# --- analyze ----------------------------------------------------------------------------


def test_analyze_refuses_too_few():
    r = C.analyze([(1000.0, 2260.0)])
    assert r["ok"] is False
    assert r["reason"] == "too-few"
    assert r["n"] == 1


def test_analyze_drops_non_finite_anchors():
    r = C.analyze([(1000.0, 2260.0), (float("nan"), 5.0), (2000.0, 3260.0), (3000.0, 4260.0)])
    assert r["n"] == 3  # the nan pair dropped


def test_analyze_offset_only_when_no_span():
    # two reads at the SAME host instant → offset known, rate not measurable
    r = C.analyze([(1000.0, 2260.0), (1000.0, 2260.0)])
    assert r["ok"] is True
    assert r["reason"] == "no-span"
    assert r["slope_ppm"] is None
    assert round(r["offset_s"], 0) == -1260.0  # device 21 min ahead
    assert "not measurable" in r["verdict"]


def test_analyze_offset_only_too_few_for_rate():
    r = C.analyze([(1000.0, 2260.0), (2000.0, 3260.0)])  # 2 anchors, has span
    assert r["ok"] is True
    assert r["reason"] == "too-few-for-rate"
    assert r["slope_ppm"] is None
    assert r["minute_is_real"] is None


def test_analyze_minute_is_real_flat_offset():
    # constant -1260 s offset across a long span → a device minute is a real minute
    anchors = [(t, t + 1260.0) for t in (0.0, 1800.0, 3600.0, 7200.0, 14400.0)]
    r = C.analyze(anchors)
    assert r["ok"] is True
    assert abs(r["slope_ppm"]) < 1.0
    assert r["minute_is_real"] is True
    assert "FIXED" in r["verdict"] and "real minute" in r["verdict"]


def test_analyze_detects_off_rate_crystal():
    # device gains 5 s over a 10000 s span on top of the offset → +500 ppm, well above the ~0.1 ppm floor
    anchors = []
    for t in (0.0, 2500.0, 5000.0, 7500.0, 10000.0):
        device = t + 1260.0 + 0.0005 * t  # device runs fast → offset (host-device) shrinks
        anchors.append((t, device))
    r = C.analyze(anchors)
    assert r["ok"] is True
    assert r["minute_is_real"] is False
    assert r["slope_ppm"] < 0  # host-device decreasing
    assert "DRIFTING" in r["verdict"]


# --- ClockSidecar -----------------------------------------------------------------------


def test_sidecar_writes_header_rows_and_blanks(tmp_path):
    p = tmp_path / "AS11CLOCK.csv"
    sc = C.ClockSidecar(str(p))
    sc.write("2026-08-24T23:00:00", 1000.0, "2026-08-24T23:21:00Z", 2260.0, -1260.0)
    sc.write("2026-08-24T23:00:30", 1030.0, None, None, None)  # a failed read → blanks
    sc.close()
    lines = p.read_text().splitlines()
    assert lines[0] == C.ClockSidecar.HEADER.strip()
    assert lines[1].split(";")[2] == "2026-08-24T23:21:00Z"
    assert lines[2].split(";") == ["2026-08-24T23:00:30", "1030.0", "", "", ""]
    assert sc.rows == 2


def test_sidecar_survives_a_restart_and_writes_one_header(tmp_path):
    # THE REGRESSION THIS FILE EXISTS FOR. The sidecar used to open "w", which TRUNCATES: every
    # daemon restart wiped the night. Measured 2026-08-25 on the box — 57,445 bytes -> 0 at the exact
    # second of `Started tepna-capture`, 11 restarts that day. Reopening must COST NOTHING.
    p = tmp_path / "AS11CLOCK.csv"
    first = C.ClockSidecar(str(p))
    first.write("2026-08-24T23:00:00", 1000.0, "2026-08-24T23:21:00Z", 2260.0, -1260.0)
    first.close()

    second = C.ClockSidecar(str(p))  # ← the restart
    second.write("2026-08-25T01:00:00", 8200.0, "2026-08-25T01:21:00Z", 9460.0, -1260.0)
    second.close()

    lines = p.read_text().splitlines()
    assert lines.count(C.ClockSidecar.HEADER.strip()) == 1  # header exactly once, not per restart
    assert len(lines) == 3  # header + BOTH rows — the pre-restart row survived
    assert lines[1].startswith("2026-08-24T23:00:00")
    assert lines[2].startswith("2026-08-25T01:00:00")


def test_sidecar_row_reaches_disk_without_close(tmp_path):
    # Line-buffered, not 64 KB: an unclean stop (SIGKILL, power loss) must not discard the rows
    # already written. At 64 KB with ~90-byte rows a working sidecar read as a 0-byte file.
    p = tmp_path / "AS11CLOCK.csv"
    sc = C.ClockSidecar(str(p))
    sc.write("2026-08-24T23:00:00", 1000.0, "2026-08-24T23:21:00Z", 2260.0, -1260.0)
    assert "2026-08-24T23:21:00Z" in p.read_text()  # readable while the handle is still OPEN
    sc.close()


def test_sidecar_double_close_is_safe(tmp_path):
    sc = C.ClockSidecar(str(tmp_path / "x.csv"))
    sc.close()
    sc.close()  # second close → flush on a closed handle → ValueError swallowed
