# tepna-capture — tests/test_ble_visibility.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The invariant under test is the one the journal violates: a count is never recorded without its
# denominator, and "could not look" is never merged into "looked and found nothing".

import ble_visibility as bv

CPAP = "04:CD:15:3A:0B:BD"
OTHER = "AA:BB:CC:DD:EE:FF"


def _rec(when, **adapters):
    return bv.make_record(when, adapters, [CPAP])


def _ok(devices):
    return {"devices": devices}


def test_a_seen_target_records_its_rssi():
    r = _rec("t0", hci0=_ok({CPAP: -40, OTHER: -70}))
    assert r["adapters"]["hci0"]["targets"][CPAP] == -40
    assert r["adapters"]["hci0"]["devices_seen"] == 2


def test_an_unseen_target_is_recorded_as_an_explicit_none():
    """An absent key and a device that was not seen must not read identically."""
    r = _rec("t0", hci0=_ok({OTHER: -70}))
    assert CPAP in r["adapters"]["hci0"]["targets"]
    assert r["adapters"]["hci0"]["targets"][CPAP] is None


def test_the_denominator_is_recorded_even_when_the_target_is_absent():
    """The whole point: 'saw nothing' and 'scanned nothing' must be distinguishable later."""
    r = _rec("t0", hci0=_ok({}), hci2=_ok({OTHER: -70}))
    assert r["adapters"]["hci0"]["devices_seen"] == 0
    assert r["adapters"]["hci2"]["devices_seen"] == 1


def test_target_matching_is_case_insensitive():
    r = bv.make_record("t0", {"hci0": _ok({CPAP.lower(): -40})}, [CPAP.lower()])
    assert r["adapters"]["hci0"]["targets"][CPAP] == -40


def test_a_failed_scan_records_the_error_and_no_denominator():
    r = _rec("t0", hci0={"error": "adapter down"})
    assert r["adapters"]["hci0"]["error"] == "adapter down"
    assert r["adapters"]["hci0"]["devices_seen"] is None
    assert r["adapters"]["hci0"]["targets"] == {}


def test_record_carries_a_version_and_a_timestamp():
    r = _rec("2026-09-04T21:00:00Z", hci0=_ok({}))
    assert r["v"] == bv.RECORD_VERSION
    assert r["t"] == "2026-09-04T21:00:00Z"


def test_round_trip_through_a_file(tmp_path):
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({CPAP: -40})))
    bv.append_record(str(p), _rec("t1", hci0=_ok({})))
    assert [r["t"] for r in bv.read_records(str(p))] == ["t0", "t1"]


def test_a_truncated_final_line_does_not_lose_the_history(tmp_path, capsys):
    """A killed process leaves a partial line; that must cost one record, not all of them."""
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({CPAP: -40})))
    with open(p, "a", encoding="utf-8") as fh:
        fh.write('{"v": 1, "t": "t1", "adap')
    assert [r["t"] for r in bv.read_records(str(p))] == ["t0"]
    err = capsys.readouterr().err
    assert "line 2 is not JSON" in err          # says WHAT it hid, never drops it silently
    assert "SKIPPED" in err


def test_blank_lines_are_ignored(tmp_path, capsys):
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({})))
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("\n\n")
    assert len(bv.read_records(str(p))) == 1
    assert capsys.readouterr().err == ""        # a blank line hides nothing, so it warns nothing


def test_visibility_reports_a_rate_over_completed_scans():
    recs = [_rec("t0", hci0=_ok({CPAP: -40})),
            _rec("t1", hci0=_ok({OTHER: -70})),
            _rec("t2", hci0=_ok({CPAP: -44}))]
    st = bv.visibility(recs, CPAP)["hci0"]
    assert st["scans_ok"] == 3
    assert st["seen"] == 2
    assert st["rate"] == 2 / 3
    assert st["median_rssi"] == -42


def test_failed_scans_are_excluded_from_the_rate_not_counted_as_misses():
    """'Could not look' merged into 'looked and found nothing' is how a blind gate reads clean."""
    recs = [_rec("t0", hci0=_ok({CPAP: -40})),
            _rec("t1", hci0={"error": "busy"}),
            _rec("t2", hci0={"error": "busy"})]
    st = bv.visibility(recs, CPAP)["hci0"]
    assert st["scans_ok"] == 1
    assert st["scans_failed"] == 2
    assert st["seen"] == 1
    assert st["rate"] == 1.0


def test_an_adapter_with_only_failed_scans_has_no_rate_at_all():
    st = bv.visibility([_rec("t0", hci0={"error": "down"})], CPAP)["hci0"]
    assert st["scans_ok"] == 0
    assert st["rate"] is None
    assert st["median_rssi"] is None
    assert st["median_devices_seen"] is None


def test_the_2026_09_04_shape_is_recoverable_from_the_log():
    """hci0 completes scans, enumerates plenty of devices, and never sees the CPAP.

    This is exactly the state that took an hour and three wrong hypotheses to reach live.
    """
    recs = ([_rec("t%d" % i, hci0=_ok({OTHER: -70}), hci2=_ok({CPAP: -40, OTHER: -70}))
             for i in range(20)])
    stats = bv.visibility(recs, CPAP)
    assert stats["hci0"]["seen"] == 0 and stats["hci0"]["scans_ok"] == 20
    assert stats["hci0"]["median_devices_seen"] == 1
    assert stats["hci2"]["rate"] == 1.0
    report = bv.format_visibility(stats, CPAP)
    assert "0/20 (0%)" in report
    assert "BLIND: hci0" in report
    assert "tepna-btreset.sh" in report


def test_a_healthy_adapter_is_not_called_blind():
    recs = [_rec("t0", hci0=_ok({CPAP: -40}))]
    report = bv.format_visibility(bv.visibility(recs, CPAP), CPAP)
    assert "BLIND" not in report
    assert "1/1 (100%)" in report


def test_an_adapter_that_never_completed_a_scan_is_not_called_blind():
    """Never looked is not the same as looked and never saw — it must not trip the BLIND banner."""
    recs = [_rec("t0", hci0={"error": "down"})]
    report = bv.format_visibility(bv.visibility(recs, CPAP), CPAP)
    assert "BLIND" not in report
    assert "no completed scan" in report
    assert "1 scan(s) FAILED" in report


def test_empty_history_says_so_rather_than_printing_a_clean_table():
    assert "nothing has been collected" in bv.format_visibility({}, CPAP)


def test_report_shows_rssi_and_device_counts_when_known():
    recs = [_rec("t0", hci0=_ok({CPAP: -40, OTHER: -70}))]
    report = bv.format_visibility(bv.visibility(recs, CPAP), CPAP)
    assert "-40" in report
    assert "2" in report.split("\n")[2]


# ── cases the mutation gate named, each one an input the fixtures could not produce ────────────

def test_records_are_written_with_sorted_keys(tmp_path):
    """Stable key order keeps a diff of the log readable and its lines comparable."""
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), {"v": 1, "t": "t0", "adapters": {}, "a": 1})
    line = p.read_text(encoding="utf-8").strip()
    keys = [seg.split('"')[1] for seg in line.split(": ")[:-1]]
    assert keys == sorted(keys)


def test_an_errored_adapter_does_not_stop_the_others_in_the_same_record():
    rec = bv.make_record("t0", {"hci0": {"error": "down"},
                                "hci2": _ok({CPAP: -40})}, [CPAP])
    stats = bv.visibility([rec], CPAP)
    assert stats["hci0"]["scans_failed"] == 1
    assert stats["hci2"]["seen"] == 1


def test_a_result_with_neither_devices_nor_error_is_an_empty_scan():
    r = bv.make_record("t0", {"hci0": {}}, [CPAP])
    assert r["adapters"]["hci0"]["devices_seen"] == 0
    assert r["adapters"]["hci0"]["targets"] == {CPAP: None}


def test_a_record_without_adapters_is_skipped_not_crashed():
    assert bv.visibility([{"v": 1, "t": "t0"}], CPAP) == {}


def test_an_adapter_entry_without_targets_counts_as_a_completed_blind_scan():
    stats = bv.visibility([{"adapters": {"hci0": {"devices_seen": 3}}}], CPAP)
    assert stats["hci0"]["scans_ok"] == 1
    assert stats["hci0"]["seen"] == 0


def test_a_scan_that_saw_zero_devices_is_recorded_as_zero_not_one():
    """`or 0` vs `or 1`: an empty scan must not be inflated into a device."""
    stats = bv.visibility([{"adapters": {"hci0": {"devices_seen": 0, "targets": {}}}}], CPAP)
    assert stats["hci0"]["median_devices_seen"] == 0


def test_a_bad_line_in_the_MIDDLE_does_not_discard_the_rest(tmp_path, capsys):
    """The truncation test puts the bad line last, so it cannot tell `continue` from `break`."""
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({CPAP: -40})))
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("{not json\n")
    bv.append_record(str(p), _rec("t2", hci0=_ok({CPAP: -41})))
    assert [r["t"] for r in bv.read_records(str(p))] == ["t0", "t2"]
    assert "line 2 is not JSON" in capsys.readouterr().err


def test_a_blank_line_in_the_MIDDLE_does_not_discard_the_rest(tmp_path):
    """Same trap as the bad-line case, one branch over: a trailing blank cannot tell
    `continue` from `break`, because there is nothing after it to lose."""
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({CPAP: -40})))
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("\n")
    bv.append_record(str(p), _rec("t2", hci0=_ok({CPAP: -41})))
    assert [r["t"] for r in bv.read_records(str(p))] == ["t0", "t2"]


def test_cli_prints_the_digest(tmp_path, capsys):
    p = tmp_path / "vis.jsonl"
    bv.append_record(str(p), _rec("t0", hci0=_ok({OTHER: -70}), hci2=_ok({CPAP: -40})))
    assert bv.main([str(p), CPAP]) == 0
    out = capsys.readouterr().out
    assert "BLIND: hci0" in out
    assert "1/1 (100%)" in out
    assert CPAP in out          # the target must reach the digest, not just the stats


def test_cli_usage_names_both_arguments(capsys):
    assert bv.main([]) == 2
    assert bv.main(["only-one-arg"]) == 2
    assert "usage: ble_visibility.py <records.jsonl> <MAC>" in capsys.readouterr().err


def test_cli_is_loud_when_the_log_cannot_be_read(tmp_path, capsys):
    rc = bv.main([str(tmp_path / "absent.jsonl"), CPAP])
    assert rc == 1
    err = capsys.readouterr().err
    assert "cannot read" in err
    assert "absent.jsonl" in err   # names the PATH it could not read, not the MAC
    assert CPAP not in err
    assert "visibility of" not in err
