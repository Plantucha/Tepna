# tepna-capture — tests/test_cpap_spool_decode.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The Summary-spool decoder on SYNTHETIC rounds: a hand-built record per case, so every expected value
# is stated here and no therapy night ships in the tree. The real-device witness (24 rounds, 0 unknown
# bytes, 75 days equal to STR.edf to the minute) is recorded in the brief, not re-run here.
import json
import os
import types

import pytest

import cpap_spool_decode as D


def _v(n: int) -> bytes:
    n &= (1 << 64) - 1
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _f(fn: int, v: int) -> bytes:
    return _v(fn << 3) + _v(v)


def _m(fn: int, body: bytes) -> bytes:
    return _v(fn << 3 | 2) + _v(len(body)) + body


START = 1791043200000  # 2026-10-03T16:00Z = local noon at UTC-4


def _record(extra: bytes = b"") -> bytes:
    sess = _m(1, _f(1, START + 585 * 60000) + _f(2, 297)) + _m(1, _f(1, START + 983 * 60000) + _f(2, 223))
    return (
        _f(1, 1)
        + _f(2, START)
        + _f(3, START + 86400000)
        + _f(4, 479)
        + _f(5, 520)
        + _m(6, sess)
        + _f(7, 312)
        + _m(14, _f(2, 5) + _f(3, 9) + _f(4, 30) + _f(5, 62))
        + _m(15, _f(2, 1040) + _f(3, 1220) + _f(4, 1300))
        + _m(26, _f(2, 1450))
        + _m(36, _f(1, 820) + _f(3, 1210))
        + _f(39, 2)
        + _f(43, 1785354106968)
        + extra
    )


def test_record_fields_scaled_and_absent_fields_null():
    r = D.decode_record(_record())
    assert r["unknown"] == []
    assert r["period_start_ms"] == START and r["duration_min"] == 520
    assert r["tz_offset_min"] == -240
    assert r["ahi"] == 3.12
    assert r["leak_lps"] == {"p50": 0.05, "p70": 0.09, "p95": 0.3, "p100": 0.62}
    assert r["inspiratory_pressure_cmh2o"] == {"p50": 10.4, "p95": 12.2, "p100": 13.0}
    assert r["inspiratory_duration_s"] == {"p50": 1.45, "p95": None, "p100": None}
    assert r["blower_pressure_cmh2o"] == {"p5": 8.2, "p95": 12.1}
    assert r["sessions"] == [
        {"start_ms": START + 585 * 60000, "duration_min": 297},
        {"start_ms": START + 983 * 60000, "duration_min": 223},
    ]
    assert r["smd_smt_timestamp_ms"] == 1785354106968
    # §∅: a documented field the record does not carry is null, never 0
    assert r["central_apnea_index"] is None and r["spo2_pct"] is None and r["heart_rate_bpm"] is None
    assert set(D.FIELD_NAMES) <= set(r)


def test_negative_int32_is_twos_complement():
    assert D.decode_record(_f(5, -3))["duration_min"] == -3


def test_unknown_field_is_counted_by_bytes_not_dropped():
    out = D.decode_round(_m(2, _record(_f(99, 7))) + _f(1, 5))
    assert out["records"][0]["unknown"] == [{"field": "99", "wire": 0, "bytes": 3}]
    assert out["unknown"] == [{"field": "outer.1", "wire": 0, "bytes": 2}]
    assert out["unknown_bytes"] == 5


def test_wrong_wire_type_on_a_known_field_is_unknown():
    r = D.decode_record(_m(5, b"\x01"))
    assert r["duration_min"] is None and r["unknown"] == [{"field": "5", "wire": 2, "bytes": 3}]


def test_unknown_inside_a_metric_and_a_session_is_counted():
    r = D.decode_record(_m(14, _f(9, 1)) + _m(6, _m(1, _f(3, 1)) + _f(2, 1)))
    assert {u["field"] for u in r["unknown"]} == {"14.9", "6.1.3", "6.2"}


def test_duplicate_scalar_is_reported():
    r = D.decode_record(_f(5, 1) + _f(5, 2))
    assert r["duration_min"] == 2 and r["unknown"] == [{"field": "dup.5", "wire": 0, "bytes": 2}]


@pytest.mark.parametrize(
    "raw",
    [
        _m(2, _record())[:-1],  # a length past the end
        b"\x10\x80",  # a varint running off the end
        b"\x10" + b"\xff" * 10 + b"\x01",  # a varint longer than 10 bytes
        b"\x0b",  # wire type 3 (group): Summary uses none
        b"\x0d\x01\x02",  # fixed32 cut short
    ],
)
def test_truncation_raises_never_short_decodes(raw):
    with pytest.raises(D.TruncatedRound):
        D.decode_round(raw)


def test_fixed_width_fields_are_walked_and_counted():
    out = D.decode_round(b"\x09" + bytes(8) + b"\x0d" + bytes(4))
    assert out["unknown_bytes"] == 14


def test_local_day_uses_the_records_own_offset():
    r = D.decode_record(_record())
    assert D.local_day(r) == "2026-10-03"
    assert D.local_day(D.decode_record(_f(2, START))) is None


def _sig(label, phys, spr=1, pmax=1440.0):
    # digital == physical: pmin 0, pmax == dmax
    return types.SimpleNamespace(
        label=label, pmin="0", pmax=str(pmax), dmin="0", dmax=str(int(pmax)), spr=spr, samples=list(phys)
    )


def test_str_days_and_compare(monkeypatch):
    import cpap_edf

    sigs = [
        _sig("Date            ", [20729], pmax=24836.0),
        _sig("Duration", [520]),
        _sig("MaskOn", [585, 983, -1], spr=3),
        _sig("MaskOff", [882, 1206, -1], spr=3),
    ]
    monkeypatch.setattr(cpap_edf, "read_edf", lambda raw: types.SimpleNamespace(signals=sigs))
    days = D.str_days(b"")
    assert days == {"2026-10-03": {"duration_min": 520, "sessions": [(585, 882), (983, 1206)]}}
    rec = D.decode_record(_record())
    rows = D.compare_str({"2026-10-03": rec}, days)
    assert rows[0]["match"] is True
    rec2 = dict(rec, duration_min=519)
    assert D.compare_str({"2026-10-03": rec2}, days)[0]["match"] is False
    assert D.compare_str({"2026-10-04": rec}, days) == []


def test_a_session_missing_a_field_is_not_compared():
    rec = D.decode_record(_f(2, START) + _m(6, _m(1, _f(1, START))) + _m(6, _m(1, _f(1, START) + _f(2, 5))))
    assert D._spool_sessions(rec) == [(0, 5)]


def _store(tmp_path, rounds):
    (tmp_path / "committed").mkdir()
    with open(tmp_path / "cpap_spool_ledger.jsonl", "w", encoding="utf-8") as fh:
        for name, raw, kind in rounds:
            if raw is not None:
                (tmp_path / "committed" / name).write_bytes(raw)
            fh.write(json.dumps({"file": name, "spool_type": kind}) + "\n")
        fh.write("\n")
    return str(tmp_path)


def test_main_clean_store_exits_zero(tmp_path, capsys):
    root = _store(tmp_path, [("a.bin", _m(2, _record()), "Summary"), ("b.bin", b"\x00", "Other")])
    assert D.main([root]) == 0
    lines = [json.loads(x) for x in capsys.readouterr().out.splitlines()]
    assert lines[0]["day"] == "2026-10-03" and lines[0]["file"] == "a.bin"
    assert lines[1] == {
        "file": "a.bin",
        "bytes": len(_m(2, _record())),
        "records": 1,
        "unknown_bytes": 0,
        "outer_unknown": [],
    }
    assert len(lines) == 2  # the non-Summary row is skipped


@pytest.mark.parametrize(
    "raw,err",
    [(None, "missing"), (b"\x10\x80", "truncated"), (_m(2, _f(99, 1)), None)],
)
def test_main_reports_and_fails(tmp_path, capsys, raw, err):
    root = _store(tmp_path, [("a.bin", raw, "Summary")])
    assert D.main([root]) == 1
    last = json.loads(capsys.readouterr().out.splitlines()[-1])
    if err:
        assert last["error"].startswith(err)
    else:
        assert last["unknown_bytes"] == 3


def test_main_str_mismatch_fails(tmp_path, capsys, monkeypatch):
    root = _store(tmp_path, [("a.bin", _m(2, _record()), "Summary")])
    monkeypatch.setattr(D, "str_days", lambda raw: {"2026-10-03": {"duration_min": 1, "sessions": []}})
    strf = os.path.join(root, "STR.edf")
    open(strf, "wb").close()
    assert D.main([root, "--str", strf]) == 1
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {"compare_days": 1, "mismatched_days": 1}
