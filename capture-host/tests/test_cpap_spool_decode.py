# tepna-capture — tests/test_cpap_spool_decode.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The Summary-spool decoder on SYNTHETIC rounds: a hand-built record per case, so every expected value
# is stated here and no therapy night ships in the tree. The real-device witness (24 rounds, 0 unknown
# bytes, 75 days equal to STR.edf to the minute) is recorded in the brief, not re-run here.
import datetime as dt
import json
import os
import re
import time
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


def test_the_scan_bound_terminates_and_names_the_bytes_it_did_not_read():
    """`walk` is bounded so that no single mutation of its index can spin it forever.

    An unbounded `while i < n` over a hand-advanced index hangs under such a mutation, and the
    mutation gate then reports that mutant UNDECIDED and refuses the whole run (CLAUDE.md §🧪).
    The default bound is one field per byte plus one, so it never binds on real input; this test
    drives it with a bound too low on purpose and asserts it stops with the unread count.
    """
    two = _f(1, 5) + _f(2, 6)
    assert [f for f, _w, _v, _n in D.walk(two)] == [1, 2]
    assert [f for f, _w, _v, _n in D.walk(two, max_fields=3)] == [1, 2]
    with pytest.raises(D.TruncatedRound, match="2 byte.s. unread"):
        list(D.walk(two, max_fields=1))


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
    assert lines[2] == {"rounds": 1, "problems": 0}
    assert len(lines) == 3  # the non-Summary row is skipped


@pytest.mark.parametrize(
    "raw,err",
    [(None, "missing"), (b"\x10\x80", "truncated"), (_m(2, _f(99, 1)), None)],
)
def test_main_reports_and_fails(tmp_path, capsys, raw, err):
    root = _store(tmp_path, [("a.bin", raw, "Summary")])
    assert D.main([root]) == 1
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[-1]) == {"rounds": 1, "problems": 1}
    last = json.loads(lines[-2])
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
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[-2]) == {"compare_days": 1, "mismatched_days": 1}
    assert json.loads(lines[-1]) == {"rounds": 1, "problems": 1}
    # the comparison row itself, not merely that one was printed
    assert json.loads(lines[-3]) == {
        "compare": {
            "day": "2026-10-03",
            "spool_min": 520,
            "str_min": 1,
            "spool_sessions": [[585, 882], [983, 1206]],  # a JSON round trip, so lists
            "str_sessions": [],
            "match": False,
        }
    }


def test_the_record_lines_sort_their_keys(tmp_path, capsys):
    """A record line is byte-identical to its own sorted re-encoding.

    The decoder builds each record in schema order, which is not alphabetical, so a line printed
    without `sort_keys` has different bytes. Sorted keys are what make one day's line diffable
    against the next run's.
    """
    root = _store(tmp_path, [("a.bin", _m(2, _record()), "Summary")])
    assert D.main([root]) == 0
    line = capsys.readouterr().out.splitlines()[0]
    assert list(json.loads(line)) == sorted(json.loads(line))
    assert line == json.dumps(json.loads(line), sort_keys=True)


def test_main_help_names_the_store_and_the_card(capsys):
    with pytest.raises(SystemExit):
        D.main(["--help"])
    out = capsys.readouterr().out
    assert "Decode committed AS11 Summary spool rounds" in out
    assert "cpap_spool_ledger.jsonl" in out and "STR.edf" in out


def test_the_problem_count_is_printed_not_collapsed_into_the_exit_code(tmp_path, capsys, monkeypatch):
    """Five rounds, four of them bad, plus one mismatched day: `problems` reads 5.

    The exit code is 1 for any number of problems, so a tally that is only returned is
    unobservable — and a counter nobody reads is a counter no test can check. It is printed.
    """
    root = _store(
        tmp_path,
        [
            ("a.bin", None, "Summary"),  # the ledger names it, the file is gone
            ("e.bin", b"\x00", "Other"),  # not Summary: not a round. MID-LEDGER on purpose:
            # stopping here instead of skipping would hide every round below.
            ("a2.bin", None, "Summary"),  # a SECOND missing file, so the tally has to add
            ("b.bin", b"\x10\x80", "Summary"),  # truncated
            ("c.bin", _m(2, _f(99, 1)), "Summary"),  # decodes, with bytes left over
            ("d.bin", _m(2, _record()), "Summary"),  # clean
        ],
    )
    monkeypatch.setattr(D, "str_days", lambda raw: {"2026-10-03": {"duration_min": 1, "sessions": []}})
    strf = os.path.join(root, "STR.edf")
    open(strf, "wb").close()
    assert D.main([root, "--str", strf]) == 1
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {"rounds": 5, "problems": 5}


def test_a_blank_ledger_line_is_skipped_and_the_scan_goes_on(tmp_path, capsys):
    """A blank line mid-ledger skips that line only. Stopping there would hide every later round."""
    (tmp_path / "committed").mkdir()
    (tmp_path / "committed" / "a.bin").write_bytes(_m(2, _record()))
    (tmp_path / "committed" / "b.bin").write_bytes(_m(2, _record()))
    with open(tmp_path / "cpap_spool_ledger.jsonl", "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"file": "a.bin", "spool_type": "Summary"}) + "\n")
        fh.write("\n")
        fh.write(json.dumps({"file": "b.bin", "spool_type": "Summary"}) + "\n")
    assert D.main([str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {"rounds": 2, "problems": 0}


def test_main_hands_the_cards_own_bytes_to_the_reader(tmp_path, capsys, monkeypatch):
    """The card is read as BYTES and passed through unchanged.

    The payload here is not valid UTF-8, so a text-mode read raises instead of returning a string.
    """
    import cpap_edf

    seen = {}

    def _fake(raw):
        seen["raw"] = raw
        return types.SimpleNamespace(
            signals=[
                _sig("Date            ", [20729], pmax=24836.0),
                _sig("Duration", [520]),
                _sig("MaskOn", [585, 983, -1], spr=3),
                _sig("MaskOff", [882, 1206, -1], spr=3),
            ]
        )

    monkeypatch.setattr(cpap_edf, "read_edf", _fake)
    root = _store(tmp_path, [("a.bin", _m(2, _record()), "Summary")])
    strf = os.path.join(root, "STR.edf")
    payload = b"\xff\xfe\x00EDF-ish"
    with open(strf, "wb") as fh:
        fh.write(payload)
    assert D.main([root, "--str", strf]) == 0
    assert seen["raw"] == payload


def test_int64_is_negative_from_the_sign_bit_itself():
    """`1 << 63` is the first negative value, not the last positive one."""
    assert D.decode_record(_f(5, 1 << 63))["duration_min"] == -(1 << 63)
    assert D.decode_record(_f(5, (1 << 63) - 1))["duration_min"] == (1 << 63) - 1


def test_a_nested_unknown_carries_its_wire_type_and_its_length():
    r = D.decode_record(_m(14, _f(9, 1)) + _m(6, _m(1, _f(3, 1)) + _f(2, 1)))
    assert r["unknown"] == [
        {"field": "14.9", "wire": 0, "bytes": 2},
        {"field": "6.1.3", "wire": 0, "bytes": 2},
        {"field": "6.2", "wire": 0, "bytes": 2},
    ]


def test_a_session_subfield_of_the_wrong_wire_type_is_unknown_not_a_session():
    """Field 6 subfield 1 is a session MESSAGE. The same id as a varint is not one."""
    r = D.decode_record(_m(6, _f(1, 7)))
    assert r["sessions"] == [] and r["unknown"] == [{"field": "6.1", "wire": 0, "bytes": 2}]


def test_an_unknown_subfield_does_not_end_the_session_scan():
    r = D.decode_record(_f(2, START) + _m(6, _f(9, 1) + _m(1, _f(1, START) + _f(2, 5))))
    assert r["unknown"] == [{"field": "6.9", "wire": 0, "bytes": 2}]
    assert r["sessions"] == [{"start_ms": START, "duration_min": 5}]


def test_a_round_level_field_2_that_is_not_a_message_is_unknown():
    out = D.decode_round(_f(2, 5))
    assert out["records"] == [] and out["unknown"] == [{"field": "outer.2", "wire": 0, "bytes": 2}]


def test_the_session_offset_is_minutes_of_sixty_thousand_milliseconds():
    """The divisor is pinned at a span where a one-millisecond error shows.

    A real session sits inside its own day, where 60000 and 60001 round alike, so the scale is
    pinned at 30001 minutes instead. This is arithmetic, not a plausible night.
    """
    rec = D.decode_record(_f(2, START) + _m(6, _m(1, _f(1, START + 30001 * 60000) + _f(2, 7))))
    assert D._spool_sessions(rec) == [(30001, 30008)]


def test_physical_scaling_spans_the_digital_range_from_its_own_minimum():
    sig = types.SimpleNamespace(pmin="-5.0", pmax="15.0", dmin="-100", dmax="100", spr=1, samples=[0, 100, -100])
    assert D._physical(sig) == [5.0, 15.0, -5.0]


def test_a_card_session_starting_at_minute_zero_is_kept(monkeypatch):
    """`-1` is the card's unused slot. `0` is midnight-ish and a real session."""
    import cpap_edf

    sigs = [
        _sig("Date            ", [20729, 20730], pmax=24836.0),
        _sig("Duration", [300, 60], spr=1),
        _sig("MaskOn", [0, 600, -1, 90, -1, -1], spr=3),
        _sig("MaskOff", [240, 660, -1, 150, -1, -1], spr=3),
    ]
    monkeypatch.setattr(cpap_edf, "read_edf", lambda raw: types.SimpleNamespace(signals=sigs))
    days = D.str_days(b"")
    # Two records, so each row's slice has to stop at its own record's slots.
    assert days["2026-10-03"] == {"duration_min": 300, "sessions": [(0, 240), (600, 660)]}
    assert days["2026-10-04"] == {"duration_min": 60, "sessions": [(90, 150)]}


def test_a_card_whose_two_session_signals_disagree_in_length_raises(monkeypatch):
    import cpap_edf

    sigs = [
        _sig("Date            ", [20729], pmax=24836.0),
        _sig("Duration", [300]),
        _sig("MaskOn", [0, 600, -1], spr=3),
        _sig("MaskOff", [240, 660], spr=3),
    ]
    monkeypatch.setattr(cpap_edf, "read_edf", lambda raw: types.SimpleNamespace(signals=sigs))
    with pytest.raises(ValueError):
        D.str_days(b"")


def test_local_day_applies_the_records_offset_to_a_utc_instant(monkeypatch):
    """The day comes from the record's own offset over a UTC instant, never from the host zone.

    The instant is chosen so the offset flips the date: 02:00 UTC is still the previous evening at
    −4 h. The host zone is set to one that is neither UTC nor the record's, so a naive conversion
    lands on a different day.
    """
    ms = int(dt.datetime(2026, 10, 4, 2, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
    rec = D.decode_record(_f(2, ms) + _f(4, 479))  # 479 zigzags to −240 minutes
    assert rec["tz_offset_min"] == -240
    old = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "Asia/Tokyo"
        time.tzset()
        assert D.local_day(rec) == "2026-10-03"
    finally:
        if old is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old
        time.tzset()


def test_fixed_width_fields_decode_little_endian_at_their_own_widths():
    """fixed64 is 8 bytes and fixed32 is 4, both least-significant byte first."""
    got = list(D.walk(b"\x09" + bytes([1, 2, 0, 0, 0, 0, 0, 0]) + b"\x15" + bytes([3, 4, 0, 0])))
    assert got == [(1, 1, 0x0201, 9), (2, 5, 0x0403, 5)]


@pytest.mark.parametrize(
    "raw,at,msg",
    [
        (b"\x10\x80", 1, "varint runs off the end at byte 2 of 2"),
        (b"\xff" * 10, 0, "varint longer than 10 bytes at byte 10"),
    ],
)
def test_a_bad_varint_names_the_byte_it_stopped_at(raw, at, msg):
    with pytest.raises(D.TruncatedRound, match=re.escape(msg)):
        D._varint(raw, at)


@pytest.mark.parametrize(
    "raw,msg",
    [
        (b"\x12\x05ab", "field 2 declares 5 bytes, 2 remain"),
        (b"\x0d\x01\x02", "field 1 declares 4 bytes, 2 remain"),
        (b"\x0b", "wire type 3 (field 1) at byte 0 is not one Summary uses"),
    ],
)
def test_a_truncated_field_names_the_field_and_the_bytes_that_remain(raw, msg):
    """The message is the evidence. A round that stops decoding has to say where and why."""
    with pytest.raises(D.TruncatedRound, match=re.escape(msg)):
        list(D.walk(raw))
