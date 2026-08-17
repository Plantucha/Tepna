# tepna-capture — tests/test_backfill_arrival.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The property under test is NOT that the report is right — `arrival_quality` has its own suite for
# that. It is that re-analysing an already-captured night CANNOT DAMAGE IT. A backfill exists because
# `QC-SUMMARY.json` is a snapshot; the moment it can write into a capture directory it stops being a
# backfill and becomes a migration.

import datetime as _dt
import json
import os
import sys

from writers import PmdArrivalLogWriter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import backfill_arrival  # noqa: E402

_T0 = _dt.datetime(2026, 8, 11, 22, 0, 0)


def _night(tmp_path, name="2026-08-12", n=400):
    d = os.path.join(tmp_path, name)
    os.makedirs(d, exist_ok=True)
    w = PmdArrivalLogWriter(os.path.join(d, "Tepna_1_PMDARRIVAL.csv"), fsync=False)
    base = 500_000_000_000
    for i in range(n):
        dev = base + i * 1_000_000_000
        w.write(_T0 + _dt.timedelta(milliseconds=(dev - base) / 1e6 + 30.0 * (i % 7)),
                "dev", "ECG", dev, dev, 10)
    w.close()
    return d


def _fingerprint(root):
    return sorted(
        (p, os.path.getsize(os.path.join(dp, f)))
        for dp, _, fs in os.walk(root)
        for f in fs
        for p in [os.path.join(dp, f)]
    )


def test_a_backfill_reads_a_night_without_altering_one_byte_of_it(tmp_path):
    d = _night(tmp_path)
    before = _fingerprint(d)
    got = backfill_arrival.backfill(d)
    assert got["sidecars"] == 1 and got["streams"], got
    assert _fingerprint(d) == before, "re-analysis must leave the capture untouched"


def test_a_night_with_no_sidecar_REPORTS_zero_rather_than_being_skipped(tmp_path):
    """`nothing to measure` and `measured nothing` are different answers; only one is a data limit."""
    d = os.path.join(tmp_path, "2026-07-25")
    os.makedirs(d)
    got = backfill_arrival.backfill(d)
    assert got == {"night": "2026-07-25", "sidecars": 0, "streams": []}


def test_a_night_directory_that_is_not_there_is_not_an_exception(tmp_path):
    got = backfill_arrival.backfill(os.path.join(tmp_path, "nope"))
    assert got["sidecars"] == 0 and got["streams"] == []


def test_the_report_carries_the_fields_an_old_summary_is_missing(tmp_path):
    d = _night(tmp_path)
    s = backfill_arrival.backfill(d)["streams"][0]
    for k in ("device_stamp_constant", "lattice", "jitter", "u_time", "offset", "quantised"):
        assert k in s, k


def test_main_prints_the_report_when_given_no_destination(tmp_path, capsys):
    d = _night(tmp_path)
    assert backfill_arrival.main([d]) == 0
    assert json.loads(capsys.readouterr().out)[0]["sidecars"] == 1


def test_main_writes_a_report_OUTSIDE_the_capture(tmp_path, capsys):
    d = _night(tmp_path)
    out = os.path.join(tmp_path, "report.json")
    assert backfill_arrival.main(["--json", out, d]) == 0
    capsys.readouterr()
    assert json.loads(open(out).read())[0]["night"] == "2026-08-12"


def test_main_REFUSES_to_write_inside_a_night_it_is_reading(tmp_path, capsys):
    """The one way this tool could do harm: overwriting the summary it exists to supplement."""
    d = _night(tmp_path)
    rc = backfill_arrival.main(["--json", os.path.join(d, "QC-SUMMARY.json"), d])
    assert rc == 2
    assert "refusing to write inside" in capsys.readouterr().err
    assert not os.path.exists(os.path.join(d, "QC-SUMMARY.json")), "and it must not have created it"


def test_it_is_runnable_as_a_script():
    """The entry guard is the whole interface — an operator runs this, nothing imports it."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "tools", "backfill_arrival.py"), encoding="utf-8").read()
    assert 'if __name__ == "__main__":' in src
    assert "raise SystemExit(main())" in src
