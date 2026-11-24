# tepna-capture — tests/test_muse_athena_gauge.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The 0x88 record is a fuel-gauge dump (brief MUSE-ATHENA-PROTOCOL §6.4). Synthetic records only."""

import json
import os
import shutil
import struct
import subprocess

import pytest

import alerts
import muse_athena as M


def _gauge_rec(percent=64.5, remaining=129, full=200, volts=46848, current=-80, temp=7040, tag=M.TAG_88, cut=0):
    data = struct.pack(
        "<HHHHHHHHhh", int(percent * 256), remaining, full, 1111, 65535, 2222, 29500, volts, current, temp
    )
    return M.Record(tag, 0, 0, data[: len(data) - cut])


def test_every_field_is_read_from_its_own_bytes():
    assert M.gauge(_gauge_rec()) == M.Gauge(64.5, 129, 200, 3660, -80, 27.5)


def test_a_charge_current_is_positive_and_a_frost_temperature_negative():
    g = M.gauge(_gauge_rec(current=300, temp=-512))
    assert (g.current, g.temp_c) == (300, -2.0)


def test_the_voltage_is_rounded_to_a_millivolt():
    assert [M.gauge(_gauge_rec(volts=v)).cell_mv for v in (38579, 53760)] == [3014, 4200]


def test_a_capacity_above_the_signed_range_stays_positive():
    g = M.gauge(_gauge_rec(remaining=40000, full=65535, volts=60000))
    assert (g.remaining, g.full, g.cell_mv) == (40000, 65535, 4688)


def test_a_zero_voltage_field_is_no_reading():
    assert M.gauge(_gauge_rec(volts=0)).cell_mv is None


def test_control_another_tag_or_a_cut_record_has_no_gauge():
    assert M.gauge(_gauge_rec(tag=M.TAG_53)) is None
    assert M.gauge(_gauge_rec(cut=1)) is None


@pytest.mark.parametrize(
    ("mv", "text"),
    [(3014, " The cell reads 3.01 V."), (3660, " The cell reads 3.66 V."), (None, "")],
)
def test_the_voltage_sentence(mv, text):
    assert alerts.battery_voltage_note(mv) == text


def _chip(args):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    src = _page()
    i = src.index("function battChip(p, mv){")
    fn = src[i : src.index("\n}\n", i) + 3]
    js = "const battClass=()=>'ok';" + fn + "console.log(JSON.stringify(%s.map(a=>battChip(...a))));" % json.dumps(args)
    return json.loads(subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=30, check=True).stdout)


def _page():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return open(os.path.join(here, "monitor.html"), encoding="utf-8").read()


def test_the_battery_chip_names_the_voltage_on_hover_and_only_there():
    (got,) = _chip([[10, 3606]])
    assert 'title="Battery 10% · cell 3.61 V"' in got and got.endswith("</span>10%</span>")


def test_control_a_device_with_no_voltage_keeps_its_chip():
    for got in _chip([[10], [10, None], [10, "3606"]]):
        assert 'title="Battery 10%"' in got
    assert _chip([[None, 3606]]) == [""]


def test_every_device_chip_passes_the_voltage():
    src = _page()
    assert "battChip(d.battery, d.battery_mv)" in src
    assert src.count("battChip(dev?dev.battery:null, dev?dev.battery_mv:null)") == 2
    assert "battChip(d.battery)" not in src and "battChip(dev?dev.battery:null)" not in src
