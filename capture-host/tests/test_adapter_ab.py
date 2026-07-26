# tepna-capture — tests/test_adapter_ab.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Comparing two BLE adapters on the same sensors.

Three dongles sit on the box and "which receives better" is measurable — but only if each night can
say which radio produced it. Until 2026-07-26 none could, so the tests weigh heaviest on the refusal
to compare a night that cannot name its adapter: the whole experiment is "which radio", making a
remembered label the one input that must never be trusted.
"""
import datetime as dt

import adapter_ab
import timeline


def _ts(h, m, s=0):
    return dt.datetime(2026, 7, 25, h, m, s).timestamp()


def _link(tmp_path, name, rows, stamp=None):
    d = tmp_path / name
    d.mkdir()
    hdr = ("Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;"
           "frames_duplicated;link_epoch;address\n")
    body = "".join(rows)
    (d / f"Tepna_{name.replace('-','')}000000_LINK.csv").write_text(
        (f"# {stamp}\n" if stamp else "") + hdr + body)
    return str(d)


def _row(t, conn, rssi, addr="AA"):
    return f"{t:%Y-%m-%dT%H:%M:%S.000};H10;{conn};{rssi};80;;;1;{addr}\n"


DEV = [{"name": "H10", "device_id": "02849638", "address": "AA", "streams": []}]


# ── the refusal ───────────────────────────────────────────────────────────────────────────────
def test_a_night_with_no_adapter_stamp_is_unattributable(tmp_path):
    """THE guard. An unstamped night cannot enter the comparison, and the operator must not be
    invited to supply the label from memory."""
    p = adapter_ab.night_profile(
        _link(tmp_path, "2026-07-25", [_row(dt.datetime(2026, 7, 25, 22, 0), 1, -60)]), DEV)
    assert p["adapter"] is None
    assert adapter_ab.unattributable(p) == ["2026-07-25"]


def test_a_stamped_night_is_attributable(tmp_path):
    p = adapter_ab.night_profile(
        _link(tmp_path, "2026-07-26", [_row(dt.datetime(2026, 7, 26, 22, 0), 1, -60)],
              stamp="adapter=C6:CF:3C:4E:75:F0 hci=hci2"), DEV)
    assert p["adapter"] == ["adapter=C6:CF:3C:4E:75:F0 hci=hci2"]
    assert adapter_ab.unattributable(p) == []


def test_the_stamp_does_not_break_the_column_header(tmp_path):
    """A comment line above the columns must not shift the parse — every existing reader takes the
    first line as the header."""
    d = _link(tmp_path, "2026-07-27", [_row(dt.datetime(2026, 7, 27, 22, 0), 1, -55)],
              stamp="adapter=AC:A7:F1:29:9D:1D hci=hci0")
    got = timeline.read_link_samples(d)
    assert list(got) == ["AA"], f"header mis-parsed with a comment present: {list(got)}"
    assert got["AA"][0][2] == -55.0


# ── the statistics that decide the verdict ────────────────────────────────────────────────────
def test_profile_reports_the_troughs_not_just_the_median(tmp_path):
    """A link is characterised by its bad moments. Two radios can share a median and differ entirely
    in how deep the troughs go, and it is the troughs that drop packets."""
    base = dt.datetime(2026, 7, 26, 22, 0)
    rows = [_row(base + dt.timedelta(seconds=30 * i), 1, r)
            for i, r in enumerate([-60] * 9 + [-95])]
    p = adapter_ab.night_profile(_link(tmp_path, "2026-07-26", rows, stamp="adapter=X hci=hci0"), DEV)
    h = p["devices"]["H10"]
    assert h["rssi_median"] == -60
    assert h["rssi_worst"] == -95, "the worst sample must survive into the report"
    assert h["frac_below_85"] == 0.1


def test_reconnects_count_edges_not_connected_samples(tmp_path):
    """A radio that holds one link and one that reconnects forty times can post the same RSSI."""
    base = dt.datetime(2026, 7, 26, 22, 0)
    seq = [1, 1, 0, 0, 1, 1, 0, 1]          # two 0->1 edges after the first connect
    rows = [_row(base + dt.timedelta(minutes=30 * i), c, -70) for i, c in enumerate(seq)]
    p = adapter_ab.night_profile(_link(tmp_path, "2026-07-26", rows, stamp="adapter=X hci=hci0"), DEV)
    h = p["devices"]["H10"]
    assert h["reconnects_per_h"] is not None
    assert round(h["reconnects_per_h"] * 3.5) == 2, "two rising edges over a 3.5 h span"


def test_compare_reports_b_minus_a_and_the_sign_is_documented(tmp_path):
    """Positive Δrssi must mean B heard the sensor MORE strongly, or every reading of the table is
    backwards."""
    a = adapter_ab.night_profile(
        _link(tmp_path, "2026-07-25", [_row(dt.datetime(2026, 7, 25, 22, 0) + dt.timedelta(seconds=30 * i), 1, -80)
                                       for i in range(6)], stamp="adapter=A hci=hci0"), DEV)
    b = adapter_ab.night_profile(
        _link(tmp_path, "2026-07-26", [_row(dt.datetime(2026, 7, 26, 22, 0) + dt.timedelta(seconds=30 * i), 1, -70)
                                       for i in range(6)], stamp="adapter=B hci=hci2"), DEV)
    c = adapter_ab.compare(a, b)
    row = c["rows"][0]
    assert row["d_rssi_median"] == 10.0, "B at -70 vs A at -80 is +10 dB for B"
    assert "B − A" in adapter_ab.render(c)


def test_the_report_states_what_a_single_night_pair_cannot_settle(tmp_path):
    """An observational A/B differs in body position, room, battery and strap fit as well as radio.
    A report that omits that invites a 2 dB difference to be read as a finding."""
    a = adapter_ab.night_profile(_link(tmp_path, "2026-07-25", [_row(dt.datetime(2026, 7, 25, 22, 0), 1, -70)],
                                       stamp="adapter=A hci=hci0"), DEV)
    b = adapter_ab.night_profile(_link(tmp_path, "2026-07-26", [_row(dt.datetime(2026, 7, 26, 22, 0), 1, -70)],
                                       stamp="adapter=B hci=hci2"), DEV)
    txt = adapter_ab.render(adapter_ab.compare(a, b))
    assert "SUGGESTIVE" in txt and "body position" in txt
