# tepna-capture — tests/test_loss_audit.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The nightly loss ledger (CAPTURE-LOSS-PRECEDENCE-AUDIT R4): gaps in the primary stream attributed to
the journal line before them, minutes per cause per device, and ONE `night-loss` verdict — UNKNOWN with
the number until the owner sets a bar, never a bar this module invented."""

import datetime as dt
import json
import os

import loss_audit
import verdict
from tests.test_verdict import js_validate

T0 = dt.datetime(2026, 9, 20, 22, 0, 0)


def _stream(path, holes, n=600, step=1.0, header="Phone timestamp;x"):
    """n rows at `step` s from T0, skipping the (start, end) second ranges in `holes`."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "\n")
        for i in range(n):
            if any(a <= i * step < b for a, b in holes):
                continue
            fh.write((T0 + dt.timedelta(seconds=i * step)).isoformat(timespec="milliseconds") + ";1\n")


def _night(tmp_path, holes=((200, 320),), hr=62):
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    _stream(str(d / "Polar_H10_0284_20260920220000_ECG.txt"), holes)
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + f";{hr}\n")
    return str(d)


DEV = [{"name": "Polar H10 0284", "model": "H10"}]


def test_stream_gaps_uses_the_cadence_cut_and_reports_span(tmp_path):
    d = _night(tmp_path, holes=((200, 320), (500, 503)))
    gaps, span, cut = loss_audit.stream_gaps(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"))
    assert cut == 5.0 and span == 599.0  # 1 s rows ⇒ cut 5 s; a 3 s hole is not a gap
    with open(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"), "a") as fh:
        fh.write("garbled row\n2026-09-20T22:10:00.000;1\n")  # a torn row is skipped; the stream goes on
    gaps2, span2, _ = loss_audit.stream_gaps(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"))
    assert span2 == 600.0 and len(gaps2) == len(gaps)
    empty = os.path.join(d, "empty.txt")
    open(empty, "w").write("Phone timestamp;x\n# a comment before the first stamp\n")
    assert loss_audit.stream_gaps(empty) == ([], 0.0, loss_audit._ni.GAP_S)
    assert [(g[0], g[1]) for g in gaps] == [(T0 + dt.timedelta(seconds=199), 121.0)]


def test_attribution_takes_the_last_journal_line_within_the_window_or_says_unattributed():
    gaps = [(T0 + dt.timedelta(seconds=199), 121.0), (T0 + dt.timedelta(seconds=400), 60.0)]
    ev = [(T0 + dt.timedelta(seconds=198), "daemon:not-worn drop"), (T0 + dt.timedelta(seconds=300), "link:dbus busy")]
    assert loss_audit.attribute(gaps, ev) == {"daemon:not-worn drop": 121 / 60, "unattributed": 1.0}
    assert loss_audit.attribute(gaps, None) == {"unattributed (no journal)": 181 / 60}
    assert loss_audit.attribute([], ev) == {}


def test_read_journal_bins_the_box_lines_and_returns_none_when_journalctl_is_unavailable():
    class R:
        returncode = 0
        stdout = (
            "2026-09-21T23:23:31-04:00 vigil python[1]: 2026-09-21 23:23:31,037 INFO Polar H10 02849638: not worn for 180s — dropping the link to save battery\n"
            "2026-09-21T23:24:00-04:00 vigil python[1]: 2026-09-21 23:24:00,000 WARNING Polar Sense 0C301E3F link error: TimeoutError('x')\n"
            "2026-09-21T23:25:00-04:00 vigil python[1]: 2026-09-21 23:25:00,000 INFO Polar H10 02849638 link error: BleakDBusError('org.bluez.Error.InProgress')\n"
            "2026-09-21T23:26:00-04:00 vigil python[1]: 2026-09-21 23:26:00,000 INFO Polar H10 02849638 connected\n"  # a line with no cause bin
            "-- no entries --\n"
        )

    ev = loss_audit.read_journal("Polar H10 02849638", T0, T0 + dt.timedelta(hours=8), run=lambda *a, **k: R())
    assert ev == [
        (dt.datetime(2026, 9, 21, 23, 23, 31), "daemon:not-worn drop"),
        (dt.datetime(2026, 9, 21, 23, 25, 0), "link:dbus busy"),
    ]

    def boom(*a, **k):
        raise OSError("no journalctl")

    assert loss_audit.read_journal("x", T0, T0, run=boom) is None

    class Bad:
        returncode = 1
        stdout = ""

    assert loss_audit.read_journal("x", T0, T0, run=lambda *a, **k: Bad()) is None


def test_audit_night_names_the_daemon_as_the_cause_and_the_verdict_is_UNKNOWN_with_the_number(tmp_path):
    d = _night(tmp_path)
    planted = [(T0 + dt.timedelta(seconds=199), "daemon:not-worn drop")]
    a = loss_audit.audit_night(d, DEV, journal=lambda name, since, until: planted)
    v = a["devices"]["Polar H10 0284"]
    assert v["fragments"] == 2 and v["lost_min"] == 2.0 and v["by_cause"] == {"daemon:not-worn drop": 2.0}
    assert v["worn_evidence"] is True and v["worn_lost_min"] == 2.0 and v["daemon_caused_min"] == 2.0
    o = loss_audit.night_verdict(a, night_dir=d, commit="abc1234")
    verdict.validate(o)
    assert js_validate(o)["ok"]
    assert o["status"] == "UNKNOWN" and "no bar has been set" in o["reason"] and "daemon-caused: 2.0 min" in o["reason"]
    assert o["result"]["worn_but_not_recorded_fraction"] == round(v["worn_lost_min"] / v["span_min"], 4)
    assert o["result"]["by_device"]["Polar H10 0284"]["top_cause"] == "daemon:not-worn drop"
    assert o["population"] == {"checked": 1, "eligible": 1, "excluded": 0}


def test_devices_without_a_primary_are_excluded_and_a_night_with_none_is_NOT_RUN(tmp_path):
    d = _night(tmp_path)
    devs = DEV + [{"name": "Ring", "model": "O2Ring-S"}, {"name": "Muse", "model": "Athena"}, "junk"]
    a = loss_audit.audit_night(d, devs, journal=lambda *a: [])
    assert a["devices"]["Ring"]["file"] is None and "no primary file" in a["devices"]["Ring"]["reason"]
    assert a["devices"]["Muse"]["primary"] is None
    o = loss_audit.night_verdict(a, night_dir=d)
    assert o["population"] == {"checked": 1, "eligible": 3, "excluded": 2}
    empty = tmp_path / "captures" / "2026-09-19"
    empty.mkdir()
    o = loss_audit.night_verdict(loss_audit.audit_night(str(empty), DEV, journal=lambda *a: []), night_dir=str(empty))
    assert o["status"] == "NOT_RUN" and "no configured device left a primary stream" in o["reason"]
    o = loss_audit.night_verdict(loss_audit.audit_night(str(empty), [], journal=lambda *a: []), night_dir=str(empty))
    assert o["status"] == "NOT_RUN" and "no device is configured" in o["reason"]


def test_no_journal_is_said_not_hidden_and_worn_evidence_is_tri_state(tmp_path):
    d = _night(tmp_path, hr=0)  # the HR file carries no beat: not worn
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: None)
    assert a["journal"].startswith("unavailable")
    v = a["devices"]["Polar H10 0284"]
    assert (
        v["by_cause"] == {"unattributed (no journal)": 2.0}
        and v["worn_evidence"] is False
        and v["worn_lost_min"] == 0.0
    )
    os.unlink(os.path.join(d, "Polar_H10_0284_20260920220000_HR.txt"))
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    assert a["devices"]["Polar H10 0284"]["worn_evidence"] is None  # no evidence file at all ⇒ null, not False
    o = loss_audit.night_verdict(a, night_dir=d)
    assert o["result"]["worn_but_not_recorded_fraction"] is None and o["status"] == "UNKNOWN"
    # an unreadable evidence file and a garbled row are skipped, not fatal
    (tmp_path / "captures" / "2026-09-20" / "Polar_H10_0284_20260920220000_HR.txt").write_text(
        "h\nx;notanumber\n1;0;3\nshort\n"
    )
    assert loss_audit._has_worn_evidence(d, "H10") is False
    os.chmod(os.path.join(d, "Polar_H10_0284_20260920220000_HR.txt"), 0)
    try:
        assert loss_audit._has_worn_evidence(d, "H10") is False  # unreadable file: skipped, not fatal
    finally:
        os.chmod(os.path.join(d, "Polar_H10_0284_20260920220000_HR.txt"), 0o644)
    assert loss_audit._has_worn_evidence(d, "Athena") is None


def test_write_night_puts_both_files_beside_the_summary_and_a_crash_is_UNKNOWN(tmp_path, monkeypatch):
    d = _night(tmp_path)
    o = loss_audit.write_night(d, DEV, commit="abc1234", journal=lambda *a: [])
    assert json.load(open(os.path.join(d, "LOSS-AUDIT.json")))["night"] == "2026-09-20"
    assert json.load(open(os.path.join(d, "LOSS-VERDICT.json")))["gate"] == "night-loss" and o["status"] == "UNKNOWN"
    monkeypatch.setattr(loss_audit, "audit_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("disk gone")))
    o = loss_audit.write_night(d, DEV, journal=lambda *a: [])
    assert o["status"] == "UNKNOWN" and "RuntimeError: disk gone" in o["reason"]
    monkeypatch.setattr(loss_audit._verdict, "write", lambda p, o: (_ for _ in ()).throw(OSError("ro")))
    assert (
        loss_audit.write_night(d, DEV, journal=lambda *a: [])["gate"] == "night-loss"
    )  # returned even when the file cannot be written


def test_an_unreadable_primary_and_a_night_name_that_is_not_a_date(tmp_path, monkeypatch):
    d = _night(tmp_path)
    monkeypatch.setattr(loss_audit, "stream_gaps", lambda p: (_ for _ in ()).throw(OSError("eio")))
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    assert "unreadable" in a["devices"]["Polar H10 0284"]["reason"]
    odd = tmp_path / "captures" / "not-a-date"
    odd.mkdir()
    assert loss_audit.audit_night(str(odd), DEV, journal=lambda *a: [])["night"] == "not-a-date"


def test_the_sample_object_is_corpus_free_and_valid_under_both_validators():
    o = loss_audit.sample_object()
    verdict.validate(o)
    assert js_validate(o)["ok"] and o["gate"] == "night-loss" and o["status"] == "UNKNOWN"
    assert o["result"]["daemon_caused_min"] == 2.0 and o["result"]["by_device"]["Polar H10 SAMPLE"]["fragments"] == 2


def test_stream_gaps_reads_the_ring_s_own_csv_layout(tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_S8AW_20260920220000_SPO2.csv"
    rows = ["Time,Oxygen Level,Pulse Rate,Motion"]
    for i in range(0, 300):
        if 100 <= i < 160:
            continue
        rows.append((T0 + dt.timedelta(seconds=i)).strftime("%H:%M:%S %d/%m/%Y") + ",96,62,0")
    p.write_text("\n".join(rows) + "\n")
    gaps, span, cut = loss_audit.stream_gaps(str(p))
    assert span == 299.0 and len(gaps) == 1 and gaps[0][1] == 61.0


# the two attribution blind spots measured on the box 2026-09-23 (28 nights): a clock re-sync pauses live
# capture and matched no bin (147 H10 min read `unattributed`), and the offline-op pause line carries only
# the ADDRESS (8,369 of 8,956), so a name-only filter never saw it. Line shapes are the box's own.
_ADDR = "AA:BB:CC:00:00:01"
_RESYNC = (
    "2026-09-20T22:03:17-04:00 vigil python[1]: 2026-09-20 22:03:17,548 WARNING Polar H10 0284 device clock is"
    " -29.2s off host (tolerance 2.0s) — re-syncing\n"
)
_PAUSED = (
    f"2026-09-20T22:06:37-04:00 vigil python[1]: 2026-09-20 22:06:37,848 INFO Polar {_ADDR}: offline-recording op"
    " — live capture paused\n"
)
_OTHER = (
    "2026-09-20T22:08:17-04:00 vigil python[1]: 2026-09-20 22:08:17,000 INFO Polar AA:BB:CC:00:00:02:"
    " offline-recording op — live capture paused\n"
)


def _journal_of(text):
    class R:
        returncode = 0
        stdout = text

    return lambda keys, since, until: loss_audit.read_journal(keys, since, until, run=lambda *a, **k: R())


def test_a_clock_resync_is_the_daemon_tearing_its_own_recording_not_an_unattributed_gap(tmp_path):
    d = _night(tmp_path, holes=((200, 290),))  # the gap opens at T0+199 s, 2 s after the re-sync line
    a = loss_audit.audit_night(d, DEV, journal=_journal_of(_RESYNC))
    v = a["devices"]["Polar H10 0284"]
    assert v["by_cause"] == {"daemon:clock re-sync": 1.5} and v["daemon_caused_min"] == 1.5


def test_an_address_only_pause_line_attributes_to_the_device_it_names_and_to_no_other(tmp_path):
    d = _night(tmp_path, holes=((400, 460), (500, 560)))  # T0+399 s after OUR pause; T0+499 s after ANOTHER's
    dev = [{"name": "Polar H10 0284", "model": "H10", "address": _ADDR}]
    a = loss_audit.audit_night(d, dev, journal=_journal_of(_PAUSED + _OTHER))
    assert a["devices"]["Polar H10 0284"]["by_cause"] == {"daemon:pull paused live": 1.0, "unattributed": 1.0}
    # the same night with no address configured: the pause line is invisible, as it was on every corpus night
    a = loss_audit.audit_night(d, DEV, journal=_journal_of(_PAUSED + _OTHER))
    assert a["devices"]["Polar H10 0284"]["by_cause"] == {"unattributed": 2.0}


def test_read_journal_takes_a_name_or_every_key_and_ignores_an_empty_one():
    class R:
        returncode = 0
        stdout = _RESYNC + _PAUSED + _OTHER

    def causes(keys):
        return [c for _, c in loss_audit.read_journal(keys, T0, T0, run=lambda *a, **k: R())]

    assert causes("Polar H10 0284") == ["daemon:clock re-sync"]
    assert causes(("Polar H10 0284", _ADDR)) == ["daemon:clock re-sync", "daemon:pull paused live"]
    assert causes(("Polar H10 0284", "")) == ["daemon:clock re-sync"]


# #2977's diff-scoped mutation run mutated audit_night and read_journal WHOLE (a changed line puts the
# function in scope) and 49 mutants survived — behaviour the original tests never observed. Each test
# below names the survivors it kills.


def test_the_journal_window_is_the_night_minus_6h_to_plus_30h_and_a_trailing_slash_is_the_same_night(tmp_path):
    # kills: the rstrip("/") mutants, the ±6 h / +30 h window mutants, the undated-night midnight mutants
    d = _night(tmp_path)
    seen = []
    a = loss_audit.audit_night(d + "/", DEV, journal=lambda keys, since, until: seen.append((since, until)) or [])
    assert a["night"] == "2026-09-20"
    assert seen == [(dt.datetime(2026, 9, 19, 18, 0), dt.datetime(2026, 9, 21, 6, 0))]
    odd = tmp_path / "captures" / "not-a-date"
    odd.mkdir()
    _stream(str(odd / "Polar_H10_0284_20260920220000_ECG.txt"), ())
    seen.clear()
    loss_audit.audit_night(str(odd), DEV, journal=lambda keys, since, until: seen.append((since, until)) or [])
    ((since, until),) = seen
    assert (since.hour, since.minute, since.second, since.microsecond) == (18, 0, 0, 0)
    assert until - since == dt.timedelta(hours=36)


def test_the_journal_is_asked_for_the_name_alone_or_the_name_and_the_address(tmp_path):
    d = _night(tmp_path)
    keys = []
    j = lambda k, since, until: keys.append(k) or []  # noqa: E731
    a = loss_audit.audit_night(d, DEV, journal=j)
    loss_audit.audit_night(d, [{"name": "Polar H10 0284", "model": "H10", "address": _ADDR}], journal=j)
    assert keys == ["Polar H10 0284", ("Polar H10 0284", _ADDR)]
    assert a["journal"] == "read"  # a journal that answered is said to have been read


def test_published_numbers_are_rounded_exactly_and_causes_are_ordered_by_minutes(tmp_path):
    # kills: span/lost/worn_lost rounding (round(x, None) is an INT — 10 == 10.0 would pass), the by_cause
    # sort key. Span 590 s = 9.8 min; gaps 31 s (first, alphabetically first) and 101 s (second).
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    _stream(str(d / "Polar_H10_0284_20260920220000_ECG.txt"), ((100, 130), (200, 300)), n=591)
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    planted = [
        (T0 + dt.timedelta(seconds=98), "daemon:clock re-sync"),
        (T0 + dt.timedelta(seconds=198), "link:dbus busy"),
    ]
    v = loss_audit.audit_night(str(d), DEV, journal=lambda *a: planted)["devices"]["Polar H10 0284"]
    assert v["span_min"] == 9.8 and v["lost_min"] == 2.2 and v["worn_lost_min"] == 2.2
    assert all(type(v[k]) is float for k in ("span_min", "lost_min", "worn_lost_min"))
    assert list(v["by_cause"].items()) == [("link:dbus busy", 1.7), ("daemon:clock re-sync", 0.5)]


def test_the_gap_cut_is_published_to_two_decimals(tmp_path):
    # kills the round(cut, 2) mutants: a 0.457 s cadence gives a cut with a third decimal
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    p = str(d / "Polar_H10_0284_20260920220000_ECG.txt")
    _stream(p, (), n=300, step=0.457)
    cut = loss_audit._ni._cadence_gap(p)
    assert round(cut, 2) != round(cut, 3)  # the fixture can tell the mutants apart (else this test is vacuous)
    v = loss_audit.audit_night(str(d), DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert v["gap_cut_s"] == round(cut, 2) and type(v["gap_cut_s"]) is float


def test_the_largest_primary_is_audited_and_an_unreadable_one_does_not_end_the_night(tmp_path, monkeypatch):
    d = _night(tmp_path)
    # a SMALLER file that sorts LAST: max(files) without the size key would pick it
    _stream(os.path.join(d, "Polar_H10_0284_20260920235959_ECG.txt"), (), n=5)
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    assert a["devices"]["Polar H10 0284"]["file"] == "Polar_H10_0284_20260920220000_ECG.txt"
    _stream(os.path.join(d, "Wellue_O2Ring-S_S8_20260920220000_SPO2.csv"), ())
    real = loss_audit.stream_gaps

    def eio_for_the_h10(p):
        if "H10" in os.path.basename(p):
            raise OSError("eio")
        return real(p)

    monkeypatch.setattr(loss_audit, "stream_gaps", eio_for_the_h10)
    devs = DEV + [{"name": "Ring", "model": "O2Ring-S"}]
    a = loss_audit.audit_night(d, devs, journal=lambda *a: [])
    assert "unreadable" in a["devices"]["Polar H10 0284"]["reason"] and a["devices"]["Ring"]["fragments"] == 1


def test_read_journal_asks_journalctl_for_exactly_the_capture_unit_and_the_window():
    calls = []

    class R:
        returncode = 0
        stdout = ""

    def run(*a, **k):
        calls.append((a, k))
        return R()

    loss_audit.read_journal("x", T0, T0 + dt.timedelta(hours=1), run=run)
    assert calls == [
        (
            (
                [
                    "journalctl",
                    "-u",
                    "tepna-capture",
                    "--no-pager",
                    "-o",
                    "short-iso",
                    "--since",
                    "2026-09-20 22:00:00",
                    "--until",
                    "2026-09-20 23:00:00",
                ],
            ),
            {"capture_output": True, "text": True, "timeout": 120},
        )
    ]


def test_a_junk_entry_or_an_unknown_model_does_not_end_the_night_and_absent_wear_evidence_is_null(tmp_path):
    # kills the `continue` → `break` mutants on the two early skips (the original test put them LAST, where
    # a break is invisible), and the no-evidence branch of worn_lost_min
    d = _night(tmp_path)
    a = loss_audit.audit_night(d, ["junk", {"name": "Muse", "model": "Athena"}] + DEV, journal=lambda *a: [])
    assert a["devices"]["Polar H10 0284"]["fragments"] == 2
    v = a["devices"]["Polar H10 0284"]
    assert v["worn_evidence"] is True and v["worn_lost_min"] == 2.0
    os.unlink(os.path.join(d, "Polar_H10_0284_20260920220000_HR.txt"))
    v = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert v["worn_evidence"] is None and v["worn_lost_min"] is None
    (tmp_path / "captures" / "2026-09-20" / "Polar_H10_0284_20260920220000_HR.txt").write_text("h\n1;0\n")
    v = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert v["worn_evidence"] is False and v["worn_lost_min"] == 0.0 and type(v["worn_lost_min"]) is float
