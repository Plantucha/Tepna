# tepna-capture — tests/test_loss_audit.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The nightly loss ledger (CAPTURE-LOSS-PRECEDENCE-AUDIT R4): gaps in the primary stream attributed to
the journal line before them, minutes per cause per device, and ONE `night-loss` verdict — UNKNOWN with
the number until the owner sets a bar, never a bar this module invented."""

import datetime as dt
import json
import os
import statistics

import pytest

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
    # the per-gap list is what the sum is made from: each gap keeps its start, length and cause, in order
    assert loss_audit.attribute_gaps(gaps, ev) == [
        (T0 + dt.timedelta(seconds=199), 121.0, "daemon:not-worn drop"),
        (T0 + dt.timedelta(seconds=400), 60.0, "unattributed"),
    ]
    assert loss_audit.attribute_gaps(gaps, None) == [
        (T0 + dt.timedelta(seconds=199), 121.0, "unattributed (no journal)"),
        (T0 + dt.timedelta(seconds=400), 60.0, "unattributed (no journal)"),
    ]


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
    # each gap by its local start, to the second — what `by_cause` sums, published so a consumer can count
    # only the gaps inside the worn interval
    assert v["gaps"] == [{"at": "2026-09-20T22:03:19", "s": 121.0, "cause": "daemon:not-worn drop"}]

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
    # a garbled row is skipped, not fatal -- the column is still read, so the verdict is still ours to give
    hr = tmp_path / "captures" / "2026-09-20" / "Polar_H10_0284_20260920220000_HR.txt"
    hr.write_text("Phone timestamp;HR [bpm]\nx;notanumber\n1;0;3\nshort\n")
    assert loss_audit._has_worn_evidence(d, "H10") is False
    # a file that could not be OPENED examined nothing, so it reports null rather than "not worn"
    os.chmod(hr, 0)
    try:
        assert loss_audit._has_worn_evidence(d, "H10") is None
    finally:
        os.chmod(hr, 0o644)
    # ... and so does a header that names no such column, and an empty file
    hr.write_text("h\nx;notanumber\n1;0;3\nshort\n")
    assert loss_audit._has_worn_evidence(d, "H10") is None
    hr.write_text("")
    assert loss_audit._has_worn_evidence(d, "H10") is None
    assert loss_audit._has_worn_evidence(d, "Athena") is None


# The two column orders the corpus actually holds for `_PPI.txt`, headers verbatim off the box. The box
# wrote the first until 2026-08-05 and the second after; a positional reader of column 1 gets the beat
# interval from one and `sensor timestamp [ns]` -- 0 on every row ever written -- from the other.
_PPI_BOX = "Phone timestamp;sensor timestamp [ns];HR [bpm];PP-interval [ms];error estimate [ms];blocker;skin contact;skin contact supported"
_PPI_PHONE = "Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]"


@pytest.mark.parametrize(
    "header,row",
    [
        (_PPI_BOX, "2026-08-04T23:00:57.020;0;0;393;30;1;1;1"),
        (_PPI_PHONE, "2026-08-19T22:33:10.377;363;30;1;1;1;0"),
    ],
    ids=["box-layout-through-2026-08-05", "phone-layout-after"],
)
def test_a_measured_beat_is_wear_evidence_in_either_PPI_column_order(tmp_path, header, row):
    """Both rows carry a real beat. Read positionally, the box row's column 1 is a fabricated 0 and the
    night -- 24 997 such rows on 2026-08-04 -- scored `worn_evidence: False`."""
    d = tmp_path / "captures" / "2026-08-04"
    d.mkdir(parents=True)
    (d / "Polar_VeritySense_0C30_20260804230037_PPI.txt").write_text(header + "\n" + row + "\n")
    assert loss_audit._has_worn_evidence(str(d), "VeritySense") is True


def test_a_PPI_file_of_nothing_but_absent_intervals_is_not_wear_evidence(tmp_path):
    """The other direction: the column is found and every value in it is absent. That IS a verdict."""
    d = tmp_path / "captures" / "2026-08-04"
    d.mkdir(parents=True)
    (d / "Polar_VeritySense_0C30_20260804230037_PPI.txt").write_text(
        _PPI_BOX + "\n" + "\n".join("2026-08-04T23:00:57.020;0;0;0;30;1;1;1" for _ in range(3)) + "\n"
    )
    assert loss_audit._has_worn_evidence(str(d), "VeritySense") is False


def test_wear_by_device_keys_by_name_and_omits_what_it_cannot_judge(tmp_path, monkeypatch):
    """The mapping `nightqc.summarize` consumes. A device with no model, an unknown model, or a
    non-dict entry is ABSENT rather than present with a null — `nightqc` reads a missing key as "not
    determined", and an entry saying nothing is one more thing that can be mistaken for a measurement."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    monkeypatch.setattr(loss_audit, "wear_ends", lambda night_dir, model: {"available": True, "model": model})
    out = loss_audit.wear_by_device(str(d), [
        {"name": "H10 chest", "model": "H10"},          # named → keyed by the name
        {"model": "VeritySense"},                       # unnamed → keyed by the model, as audit_night does
        {"name": "Athena", "model": "Athena-9"},        # unknown model → no wear rule → omitted
        {"name": "No model"},                           # no model at all → omitted
        "not a dict",                                   # junk → skipped, not fatal
    ])
    assert set(out) == {"H10 chest", "VeritySense"}
    assert out["H10 chest"]["model"] == "H10" and out["VeritySense"]["model"] == "VeritySense"
    assert loss_audit.wear_by_device(str(d), []) == {} and loss_audit.wear_by_device(str(d), None) == {}


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
    # a file whose named column was read and held nothing but absent values IS a "not worn" verdict ...
    (tmp_path / "captures" / "2026-09-20" / "Polar_H10_0284_20260920220000_HR.txt").write_text(
        "Phone timestamp;HR [bpm]\n1;0\n"
    )
    v = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert v["worn_evidence"] is False and v["worn_lost_min"] == 0.0 and type(v["worn_lost_min"]) is float
    # ... where one whose header names no such column examined nothing, and says so
    (tmp_path / "captures" / "2026-09-20" / "Polar_H10_0284_20260920220000_HR.txt").write_text("h\n1;0\n")
    v = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert v["worn_evidence"] is None and v["worn_lost_min"] is None


# ── WEAR ENDS ─────────────────────────────────────────────────────────────────────────────────────
# Synthetic files at low rates (epoch_stats is rate-agnostic), shaped on the measured nights: a worn H10
# at a small sd with an off-body tail ~12x above it (2026-09-23: 80 µV → 1 100–2 200 µV); a Verity whose
# final epoch carries the removal burst.
import math as _m

W0 = dt.datetime(2026, 9, 23, 23, 0, 0)


def _wave(
    path, secs, fs, amp_of, header="Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]", t0=W0, cols=1
):
    """`secs` seconds of rows at `fs`; `amp_of(t)` gives the sample amplitude at second t (a sine, so the
    epoch sd is amp/√2). `cols` = 1 writes one value in column 3; 3 writes an ACC-like x;y;z in columns 2–4."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "\n")
        for i in range(int(secs * fs)):
            t = i / fs
            v = amp_of(t) * _m.sin(2 * _m.pi * 1.3 * t)
            stamp = (t0 + dt.timedelta(seconds=t)).isoformat(timespec="milliseconds")
            if cols == 1:
                fh.write(f"{stamp};0;0;{v:.3f}\n")
            else:
                # gravity on z, the motion on x AND z: an arm that moves changes |a|, which is what the rule reads
                fh.write(f"{stamp};0;{v:.3f};0;{1000 + v:.3f}\n")


def _ppg(path, secs, fs, amb_sd_of, t0=W0):
    """A Verity-shaped PPG: ambient in column 5, oscillating with amplitude amb_sd_of(t)·√2 around -180."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient\n")
        for i in range(int(secs * fs)):
            t = i / fs
            a = -180 + amb_sd_of(t) * _m.sqrt(2) * _m.sin(2 * _m.pi * 0.9 * t)
            fh.write(
                f"{(t0 + dt.timedelta(seconds=t)).isoformat(timespec='milliseconds')};0;400000;400000;400000;{a:.2f}\n"
            )


def test_h10_tail_calls_a_sustained_off_body_tail_and_publishes_its_own_margin():
    worn = [80.0] * 100
    assert loss_audit.h10_tail(worn + [800.0] * 6) == {
        "epochs": 106,
        "trailing_off_epochs": 6,
        "tail_off": True,
        "max_worn_run": 0,
    }
    # one epoch short of the rule is NOT a doff — the boundary is the run length, stated at 6
    assert loss_audit.h10_tail(worn + [800.0] * 5)["tail_off"] is False
    # exactly 5x the median counts (>=); just under does not
    assert loss_audit.h10_tail(worn + [400.0] * 6)["tail_off"] is True
    assert loss_audit.h10_tail(worn + [399.0] * 6)["trailing_off_epochs"] == 0
    # the worn run is counted OUTSIDE the trailing run, so the margin is visible on every block
    mid = worn[:50] + [600.0] * 4 + worn[50:] + [900.0] * 7
    assert loss_audit.h10_tail(mid) == {"epochs": 111, "trailing_off_epochs": 7, "tail_off": True, "max_worn_run": 4}
    assert loss_audit.h10_tail(worn[:59]) is None  # no baseline under 10 min
    assert loss_audit.h10_tail([0.0] * 80) is None  # no variance to judge against


def test_verity_end_rule_and_the_named_reasons():
    assert loss_audit.verity_end_doff(1.5, None) is True
    assert loss_audit.verity_end_doff(None, 150.0) is True
    assert loss_audit.verity_end_doff(1.49, 149.9) is False
    assert loss_audit.verity_end_doff(0.96, 139.5) is False  # the held-out miss, 2026-09-19 06:04, as recorded
    assert loss_audit.verity_end_doff(None, None) is None
    assert loss_audit.end_reason(True, None) == "doff"
    assert loss_audit.end_reason(True, 30.0) == "doff"  # a removal is a removal even if re-worn soon
    assert loss_audit.end_reason(False, 1800.0) == "link-loss"
    assert loss_audit.end_reason(None, 90.0) == "link-loss"
    assert loss_audit.end_reason(False, 1801.0) == "quiet-end-unclassified"
    assert loss_audit.end_reason(False, None) == "quiet-end-unclassified"


def test_epoch_stats_bins_on_the_clock_across_midnight_and_drops_torn_edges(tmp_path):
    p = tmp_path / "x_ECG.txt"
    # 23:59:40 → 00:00:40 at 10 Hz: six clock-aligned epochs spanning midnight; amplitude 10 then 100
    _wave(str(p), 60, 10, lambda t: 10.0 if t < 30 else 100.0, t0=dt.datetime(2026, 9, 23, 23, 59, 40))
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("Phone timestamp;junk\n2026-09-24T00:00:40.000;0;0;notanumber\nshort\n")
        fh.write("2026-09-24T00:00:45.000;0;0;5.0\n")  # ONE row into a new epoch: under half fill → dropped
    ep, last = loss_audit.epoch_stats(str(p), [3])
    assert [e[0] for e in ep] == [dt.datetime(2026, 9, 23, 23, 59, 40) + dt.timedelta(seconds=10 * k) for k in range(6)]
    assert all(e[1] == 100 for e in ep)
    assert round(ep[0][2], 1) == round(10 / _m.sqrt(2), 1) and round(ep[5][2], 1) == round(100 / _m.sqrt(2), 1)
    assert last == dt.datetime(2026, 9, 24, 0, 0, 45)  # the last parsed row, torn ones excluded
    acc = tmp_path / "a_ACC.txt"
    _wave(str(acc), 20, 10, lambda t: 50.0, cols=3)
    ep, _ = loss_audit.epoch_stats(str(acc), [2, 3, 4])  # three columns → vector magnitude
    assert len(ep) == 2 and all(e[2] > 0 for e in ep)
    empty = tmp_path / "e_ECG.txt"
    empty.write_text("Phone timestamp;x\n")
    assert loss_audit.epoch_stats(str(empty), [3]) == ([], None)


def _h10_night(tmp_path, tail_secs, *, name="2026-09-23", start="20260923230000", off_amp=1600.0):
    d = tmp_path / "captures" / name
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"Polar_H10_0284_{start}_ECG.txt"
    worn_secs = 900
    _wave(str(f), worn_secs + tail_secs, 20, lambda t: 110.0 if t < worn_secs else off_amp)
    return d, f


def test_an_h10_that_ends_off_body_is_a_doff_and_its_worn_interval_ends_where_the_tail_began(tmp_path):
    d, _ = _h10_night(tmp_path, 300)  # 5 min of empty strap after 15 min worn
    w = loss_audit.wear_ends(str(d), "H10")
    (e,) = w["ends"]
    assert e["reason"] == "doff" and e["trailing_off_epochs"] == 30 and e["max_worn_run"] == 0
    assert e["worn_end_at"] == "2026-09-23T23:15:00" and e["end_at"] == "2026-09-23T23:19:59"
    assert w["worn_end"] == {"at": "2026-09-23T23:15:00", "reason": "doff", "file": e["file"]}


def test_a_clean_h10_end_is_a_link_loss_when_the_stream_returns_and_unclassified_when_it_does_not(tmp_path):
    d, _ = _h10_night(tmp_path, 50)  # 50 s of tail: under the 60 s rule
    e = loss_audit.wear_ends(str(d), "H10")["ends"][0]
    assert e["reason"] == "quiet-end-unclassified" and e["relink_gap_s"] is None and e["worn_end_at"] == e["end_at"]
    # the same stream's next file 5 min later — in TOMORROW's folder, which the reconnect search reads too
    nxt = tmp_path / "captures" / "2026-09-24"
    nxt.mkdir()
    (nxt / "Polar_H10_0284_20260923232046_ECG.txt").write_text("Phone timestamp;x\n")
    e = loss_audit.wear_ends(str(d), "H10")["ends"][0]
    last_row = dt.datetime(2026, 9, 23, 23, 15, 49, 950000)  # 950 s of 20 Hz rows from 23:00:00
    assert e["reason"] == "link-loss" and e["relink_gap_s"] == round(
        (dt.datetime(2026, 9, 23, 23, 20, 46) - last_row).total_seconds()
    )
    assert loss_audit._relink_gap(str(tmp_path / "not-a-date"), "Polar_H10_*_ECG.txt", W0) is None


def test_files_that_cannot_be_judged_say_why_and_never_supply_the_worn_end(tmp_path, monkeypatch):
    d = tmp_path / "captures" / "2026-09-23"
    d.mkdir(parents=True)
    _wave(str(d / "Polar_H10_0284_20260923230000_ECG.txt"), 300, 20, lambda t: 100.0)  # 30 epochs < 60
    _wave(str(d / "Polar_H10_0284_20260923231000_ECG.txt"), 700, 20, lambda t: 0.0)  # flat: no variance
    w = loss_audit.wear_ends(str(d), "H10")
    assert [e["reason"] for e in w["ends"]] == ["under 60 epochs of 10 s", "no ECG variance to judge a tail against"]
    assert w["worn_end"] is None
    real = loss_audit.epoch_stats
    monkeypatch.setattr(
        loss_audit, "epoch_stats", lambda p, c: (_ for _ in ()).throw(OSError("eio")) if "231000" in p else real(p, c)
    )
    assert loss_audit.wear_ends(str(d), "H10")["ends"][1]["reason"].startswith("unreadable")
    assert loss_audit.wear_ends(str(d), "CPAP") == {
        "available": False,
        "reason": "no wear-end rule for model 'CPAP'",
    }


def test_a_verity_end_is_judged_on_its_final_clock_aligned_epoch(tmp_path):
    d = tmp_path / "captures" / "2026-09-23"
    d.mkdir(parents=True)
    # 6 min worn (ambient sd 37), then the final epoch uncovered (sd x3, the dark-room 09-23 shape)
    ppg = d / "Polar_VeritySense_0C30_20260923230000_PPG.txt"
    _ppg(str(ppg), 370, 20, lambda t: 37.0 if t < 360 else 111.0)
    w = loss_audit.wear_ends(str(d), "VeritySense")
    (e,) = w["ends"]
    assert e["reason"] == "doff" and e["final_amb_ratio"] == 3.0 and e["final_acc_sd"] is None
    assert e["final_epoch_at"] == "2026-09-23T23:06:00" and e["worn_end_at"] == e["end_at"]
    # dark AND still (ambient flat) but the arm moves: the ACC half of the rule, from the ACC file's tail
    _ppg(str(ppg), 370, 20, lambda t: 37.0)
    acc = d / "Polar_VeritySense_0C30_20260923230000_ACC.txt"
    _wave(
        str(acc),
        370,
        10,
        lambda t: 2.0 if t < 360 else 400.0,
        header="Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
        cols=3,
    )
    e = loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]
    assert e["reason"] == "doff" and e["final_amb_ratio"] == 1.0 and e["final_acc_sd"] > 150
    # neither cue: a link loss if the stream came back, which is what the label was
    _wave(str(acc), 370, 10, lambda t: 2.0, header="h", cols=3)
    (d / "Polar_VeritySense_0C30_20260923231000_PPG.txt").write_text("Phone timestamp;x\n")
    e = loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]
    assert e["reason"] == "link-loss" and e["final_acc_sd"] < 150
    # too few ACC rows in the final epoch is not a motion measurement
    _wave(str(acc), 365, 5, lambda t: 400.0, header="h", cols=3)
    assert loss_audit._final_acc_sd(str(acc), dt.datetime(2026, 9, 23, 23, 6, 0)) is None


def test_audit_night_carries_the_wear_block_per_device(tmp_path):
    d, _ = _h10_night(tmp_path, 300, name="2026-09-20", start="20260920220000")
    a = loss_audit.audit_night(str(d), DEV, journal=lambda *a: [])
    assert a["devices"]["Polar H10 0284"]["wear"]["worn_end"]["reason"] == "doff"


def _rows(path, rows, header="Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]", raw_tail=b""):
    """Write explicit rows: [(stamp_str, [values...])] → 'stamp;0;<values joined by ;>'. `raw_tail` is appended
    as BYTES, so a non-UTF-8 row can be planted."""
    with open(path, "wb") as fh:
        if header is not None:
            fh.write((header + "\n").encode())
        for stamp, vals in rows:
            fh.write((stamp + ";0;" + ";".join(f"{v}" for v in vals) + "\n").encode())
        fh.write(raw_tail)


def _st(t0, secs):
    return (t0 + dt.timedelta(seconds=secs)).isoformat(timespec="milliseconds")


def test_epoch_stats_sd_is_the_population_sd_of_exactly_the_epochs_rows(tmp_path):
    # a DC offset AND a phase, so every epoch's mean is far from its first value: a variance formula that
    # got the mean term wrong cannot hide behind a zero-mean sine
    t0 = dt.datetime(2026, 9, 23, 23, 59, 40)
    vals = [(k, 500.0 + 37.0 * _m.cos(0.9 * k) + (k % 7)) for k in range(60)]  # 1 Hz: six 10-s epochs
    p = tmp_path / "x_ECG.txt"
    _rows(str(p), [(_st(t0, k), [0, v]) for k, v in vals])
    ep, last = loss_audit.epoch_stats(str(p), [3])
    assert [e[0] for e in ep] == [t0 + dt.timedelta(seconds=10 * j) for j in range(6)]  # across midnight
    for j, (_start, n, sd) in enumerate(ep):
        want = statistics.pstdev([v for k, v in vals if 10 * j <= k < 10 * j + 10])
        assert n == 10 and abs(sd - want) < 1e-9
    assert last == t0 + dt.timedelta(seconds=59)


def test_epoch_stats_skips_what_is_not_a_sample_and_keeps_what_is(tmp_path):
    t0 = dt.datetime(2026, 9, 23, 23, 0, 0)
    rows = [(_st(t0, k), [0, float(k)]) for k in range(20)]
    rows.append(("2026-09-23T23:00:20", [0, 7.0]))  # a 19-char stamp (no ms) IS a sample
    rows += [
        (_st(t0, k), [0, float(k)]) for k in range(25, 30)
    ]  # fill the third epoch past half, so only the planted rows decide
    p = tmp_path / "x_ECG.txt"
    _rows(
        str(p),
        rows,
        raw_tail=(
            "2026-09-23T23:00:21.000;0;0\n"  # a row missing its value column: skipped, no crash
            "2026-09-23T23:00:22.000;0;0;notanumber\n"  # torn: skipped
            "2026-09-23T23:00:2;0;0;1.0\n"  # an 18-char stamp: skipped
        ).encode()
        + b"2026-09-23T23:00:23.000;0;0;\xff9\n"  # a non-UTF-8 byte in the value: skipped, not fatal
        + b"2026-09-23T23:00:24.500Z;0;0;3.0\n",
    )  # a zone suffix after the ms: the time still parses
    ep, last = loss_audit.epoch_stats(str(p), [3])
    assert [e[1] for e in ep] == [
        10,
        10,
        7,
    ]  # 20..29: the 19-char row, 24.500Z and 25..29 — the four bad rows are not counted
    assert last == dt.datetime.fromisoformat("2026-09-23T23:00:24.500")


def test_epoch_stats_drops_an_epoch_under_half_the_median_fill_and_keeps_one_at_exactly_half(tmp_path):
    t0 = dt.datetime(2026, 9, 23, 23, 0, 0)

    def fill(counts):
        rows = []
        for j, c in enumerate(counts):
            rows += [(_st(t0, 10 * j + 0.1 * i), [0, float(i * i)]) for i in range(c)]
        p = tmp_path / f"f{'_'.join(map(str, counts))}_ECG.txt"
        _rows(str(p), rows)
        return [e[1] for e in loss_audit.epoch_stats(str(p), [3])[0]]

    assert fill([4, 4, 4, 2]) == [4, 4, 4, 2]  # 2 = exactly half of 4: kept
    assert fill([8, 8, 8, 3]) == [8, 8, 8]  # 3 < 4: dropped
    assert fill([2, 2, 2, 1]) == [2, 2, 2]  # one row is never an sd, however small the fill
    assert loss_audit.epoch_stats(str(_empty(tmp_path)), [3]) == ([], None)


def _empty(tmp_path):
    p = tmp_path / "empty_ECG.txt"
    p.write_text("Phone timestamp;x\n")
    return p


def test_the_acc_magnitude_of_the_final_epoch_is_read_from_the_file_tail_exactly(tmp_path):
    start = dt.datetime(2026, 9, 23, 23, 6, 0)
    xyz = [(3.0 * i, 2.0 * i + 1, 1000.0 - i) for i in range(51)]
    rows = [(_st(start, 0.1 * i), [x, y, z]) for i, (x, y, z) in enumerate(xyz)]
    p = tmp_path / "v_ACC.txt"
    _rows(str(p), rows, header=None)  # NO header: the first byte is a sample's
    want = statistics.pstdev([_m.sqrt(x * x + y * y + z * z) for x, y, z in xyz])
    assert abs(loss_audit._final_acc_sd(str(p), start) - want) < 1e-9  # 51 rows: measured
    _rows(str(p), rows[:50], header=None)
    assert loss_audit._final_acc_sd(str(p), start) is None  # 50: not a measurement
    # a torn row EARLY in the window is skipped, and the rows after it still count
    _rows(str(p), [rows[0], (_st(start, 0.05), ["x", 0, 0])] + rows[1:], header=None, raw_tail=b"")
    assert abs(loss_audit._final_acc_sd(str(p), start) - want) < 1e-9
    _rows(str(p), rows, header=None, raw_tail=(_st(start, 5.0) + ";0;\xff;0;0\n").encode("latin-1"))
    assert abs(loss_audit._final_acc_sd(str(p), start) - want) < 1e-9  # a non-UTF-8 row: skipped
    assert loss_audit._final_acc_sd(str(tmp_path / "absent_ACC.txt"), start) is None


def test_the_reconnect_search_window_and_its_folders(tmp_path):
    night = tmp_path / "captures" / "2026-09-23"
    night.mkdir(parents=True)
    end = dt.datetime(2026, 9, 23, 23, 15, 50)
    pat = "Polar_H10_*_ECG.txt"

    def only(stamp, folder=night):
        for f in list(night.glob("*")) + list((tmp_path / "captures").glob("2026-09-24/*")):
            f.unlink()
        folder.mkdir(exist_ok=True)
        (folder / f"Polar_H10_0284_{stamp}_ECG.txt").write_text("h\n")
        return loss_audit._relink_gap(str(night), pat, end)

    assert only("20260923231545") is None  # exactly end - 5 s: the same session, not a reconnect
    assert only("20260923231546") == -4.0  # end - 4 s: inside the tolerance, counted
    assert only("20260923231600") == 10.0
    nxt = tmp_path / "captures" / "2026-09-24"
    assert only("20260924000500", nxt) == 2950.0  # tomorrow's folder is searched too
    assert loss_audit._relink_gap(str(night) + "/", pat, end) == 2950.0  # a trailing slash is the same night
    (night / "Polar_H10_0284_nostamp_ECG.txt").write_text("h\n")  # a name without a start stamp: ignored
    assert loss_audit._relink_gap(str(night), pat, end) == 2950.0
    assert loss_audit._relink_gap(str(tmp_path / "not-a-date"), pat, end) is None


def test_the_worn_end_is_the_LATEST_usable_end_and_each_end_names_its_file(tmp_path):
    d = tmp_path / "captures" / "2026-09-23"
    d.mkdir(parents=True)
    _wave(
        str(d / "Polar_H10_0284_20260923220000_ECG.txt"),
        700,
        20,
        lambda t: 110.0,
        t0=dt.datetime(2026, 9, 23, 22, 0, 0),
    )
    _wave(str(d / "Polar_H10_0284_20260923230000_ECG.txt"), 1200, 20, lambda t: 110.0 if t < 900 else 1600.0)
    w = loss_audit.wear_ends(str(d), "H10")
    assert w["available"] is True
    assert [e["file"] for e in w["ends"]] == [
        "Polar_H10_0284_20260923220000_ECG.txt",
        "Polar_H10_0284_20260923230000_ECG.txt",
    ]
    assert w["ends"][0]["reason"] == "quiet-end-unclassified"  # its "next file" starts 48 min later: not a reconnect
    assert w["worn_end"] == {
        "at": "2026-09-23T23:15:00",
        "reason": "doff",
        "file": "Polar_H10_0284_20260923230000_ECG.txt",
    }


def test_an_h10_file_of_exactly_the_minimum_length_is_judged(tmp_path):
    d = tmp_path / "captures" / "2026-09-23"
    d.mkdir(parents=True)
    _wave(str(d / "Polar_H10_0284_20260923230000_ECG.txt"), 600, 20, lambda t: 110.0)  # exactly 60 epochs
    e = loss_audit.wear_ends(str(d), "H10")["ends"][0]
    assert e["usable"] is True and e["epochs"] == 60 and e["reason"] == "quiet-end-unclassified"


def test_h10_tail_boundaries_the_survivors_named():
    assert loss_audit.h10_tail([80.0] * 60)["epochs"] == 60  # exactly the floor
    assert loss_audit.h10_tail([0.5] * 70 + [2.5] * 6)["tail_off"] is True  # a sub-1 median still judges
    assert loss_audit.h10_tail([80.0] * 70 + [400.0] * 3 + [80.0] * 10)["max_worn_run"] == 3  # exactly 5x counts


def test_verity_final_epoch_ratio_rounding_and_a_flat_ambient(tmp_path):
    d = tmp_path / "captures" / "2026-09-23"
    d.mkdir(parents=True)
    ppg = d / "Polar_VeritySense_0C30_20260923230000_PPG.txt"
    _ppg(str(ppg), 370, 20, lambda t: 37.0 if t < 360 else 41.0)  # 41/37 = 1.1081…
    e = loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]
    assert e["final_amb_ratio"] == 1.11 and e["file"] == ppg.name
    _ppg(str(ppg), 370, 20, lambda t: 0.3 if t < 360 else 0.6)  # a median under 1 still yields a ratio
    assert loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]["final_amb_ratio"] == 2.0
    _ppg(str(ppg), 370, 20, lambda t: 0.0)  # flat ambient: no ratio, not a division
    e = loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]
    assert e["final_amb_ratio"] is None and e["reason"] == "quiet-end-unclassified"
    acc = d / "Polar_VeritySense_0C30_20260923230000_ACC.txt"
    _rows(
        str(acc),
        [(_st(dt.datetime(2026, 9, 23, 23, 6, 0), 0.1 * i), [float(i), 0, 1000.0]) for i in range(60)],
        header=None,
    )
    want = statistics.pstdev([_m.sqrt(i * i + 1000.0**2) for i in range(60)])
    assert loss_audit.wear_ends(str(d), "VeritySense")["ends"][0]["final_acc_sd"] == round(want, 1)


def test_the_acc_magnitude_path_and_an_underfilled_epoch_between_full_ones(tmp_path):
    t0 = dt.datetime(2026, 9, 23, 23, 0, 0)
    xyz = [(3.0 * k, (k % 5) * 2.0, 1000.0 - k) for k in range(20)]
    p = tmp_path / "a_ACC.txt"
    _rows(
        str(p),
        [(_st(t0, k), list(v)) for k, v in enumerate(xyz)],
        header="Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
    )
    ep, _ = loss_audit.epoch_stats(str(p), [2, 3, 4])
    for j, (_s, n, sd) in enumerate(ep):
        want = statistics.pstdev([_m.sqrt(x * x + y * y + z * z) for x, y, z in xyz[10 * j : 10 * j + 10]])
        assert n == 10 and abs(sd - want) < 1e-9  # the vector magnitude, not the first axis
    rows = []
    for j, c in enumerate([4, 1, 4, 4]):  # an under-filled epoch BETWEEN full ones
        rows += [(_st(t0, 10 * j + 0.1 * i), [0, float(i * i)]) for i in range(c)]
    q = tmp_path / "u_ECG.txt"
    _rows(str(q), rows)
    assert [e[0] for e in loss_audit.epoch_stats(str(q), [3])[0]] == [
        t0,
        t0 + dt.timedelta(seconds=20),
        t0 + dt.timedelta(seconds=30),
    ]


def test_an_acc_row_at_the_next_epochs_first_millisecond_is_not_in_the_final_epoch(tmp_path):
    start = dt.datetime(2026, 9, 23, 23, 6, 0)
    xyz = [(3.0 * i, 2.0 * i + 1, 1000.0 - i) for i in range(51)]
    rows = [(_st(start, 0.1 * i), list(v)) for i, v in enumerate(xyz)] + [(_st(start, 10.0), [9000.0, 0, 0])]
    p = tmp_path / "v_ACC.txt"
    _rows(str(p), rows, header=None)
    want = statistics.pstdev([_m.sqrt(x * x + y * y + z * z) for x, y, z in xyz])
    assert abs(loss_audit._final_acc_sd(str(p), start) - want) < 1e-9


def test_the_published_gaps_are_exactly_what_by_cause_sums(tmp_path):
    d = _night(tmp_path, holes=((200, 320), (400, 430.5)))
    planted = [(T0 + dt.timedelta(seconds=199), "link:dbus busy")]
    v = loss_audit.audit_night(d, DEV, journal=lambda name, since, until: planted)["devices"]["Polar H10 0284"]
    assert [(g["at"], g["s"], g["cause"]) for g in v["gaps"]] == [
        ("2026-09-20T22:03:19", 121.0, "link:dbus busy"),
        ("2026-09-20T22:06:39", 32.0, "unattributed"),
    ]
    summed: dict = {}
    for g in v["gaps"]:
        summed[g["cause"]] = summed.get(g["cause"], 0.0) + g["s"] / 60
    assert {k: round(x, 1) for k, x in summed.items()} == v["by_cause"]
    assert v["fragments"] == len(v["gaps"]) + 1


def test_a_gap_is_published_as_a_float_of_whole_seconds_and_its_cause_window_is_inclusive(tmp_path):
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    # 4 rows a second, hole [200, 260): stamps resolve to the SECOND (nights_index.parse_stamp), so the gap runs
    # from 22:03:19 to 22:04:20 = 61 s — published as the FLOAT 61.0, never the int a bare round() returns
    _stream(str(d / "Polar_H10_0284_20260920220000_ECG.txt"), ((200, 260),), n=1200, step=0.25)
    gap_start = T0 + dt.timedelta(seconds=199)
    exactly_the_window = [(gap_start - dt.timedelta(seconds=loss_audit.ATTRIB_WINDOW_S), "link:dbus busy")]
    v = loss_audit.audit_night(str(d), DEV, journal=lambda name, since, until: exactly_the_window)
    (g,) = v["devices"]["Polar H10 0284"]["gaps"]
    assert g == {"at": "2026-09-20T22:03:19", "s": 61.0, "cause": "link:dbus busy"}  # the window's edge still names it
    assert isinstance(g["s"], float)


# ── the ring: two of the device's own witnesses — the PPG2W off-finger tail AND the SpO2 stream stopping there ──
R0 = dt.datetime(2026, 9, 22, 22, 39, 24)
RING_HDR = "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n"


def _ring(d, start, worn_s, off_s, spo2_s, per_sec=199):
    """A ring session opened at `start`: PPG2W worn for `worn_s` then off-finger for `off_s` (per_sec rows each
    second), and an SpO2 file reading 1 Hz for `spo2_s` seconds from `start`."""
    stamp = start.strftime("%Y%m%d%H%M%S")
    with open(d / f"Wellue_O2Ring-S_S8AW2100_{stamp}_PPG2W.txt", "w") as fh:
        fh.write(RING_HDR)
        for sec in range(worn_s + off_s):
            a, b = (1_650_000, 1_500_000) if sec < worn_s else (3_400_000, 150)
            for k in range(per_sec):
                t = start + dt.timedelta(seconds=sec + k / per_sec)
                fh.write(f"{t.isoformat(timespec='milliseconds')};0;{a};{b};0\n")
    with open(d / f"Wellue_O2Ring-S_S8AW2100_{stamp}_SPO2.csv", "w") as fh:
        fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        for sec in range(spo2_s):
            fh.write((start + dt.timedelta(seconds=sec)).strftime("%H:%M:%S %d/%m/%Y") + ",97,58,0\n")


def _ring_dir(tmp_path):
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    return d


def test_a_ring_doff_is_the_tails_first_second_when_the_spo2_stream_stopped_there(tmp_path):
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=120, off_s=40, spo2_s=119)  # SpO2's last row at +118 s; the tail starts at +120 s
    w = loss_audit.wear_ends(str(d), "O2Ring-S")
    (e,) = w["ends"]
    assert e["reason"] == "doff" and e["tail_off"] is True and e["ppg2w_contradicted"] is False
    assert e["doff_at"] == e["worn_end_at"] == (R0 + dt.timedelta(seconds=120)).isoformat()
    assert e["end_at"] == (R0 + dt.timedelta(seconds=118)).isoformat()
    assert e["ppg2w_file"] == "Wellue_O2Ring-S_S8AW2100_20260922223924_PPG2W.txt" and e["ppg2w_unusable"] is None
    assert w["worn_end"] == {"at": e["worn_end_at"], "reason": "doff", "file": e["file"]}


def test_a_ring_tail_the_spo2_stream_contradicts_is_published_and_is_not_a_doff(tmp_path):
    # 2026-09-11 20:15: the ratio drifted over the band with the finger IN — SpO2 kept reading 202 s past the "doff".
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=100, off_s=202, spo2_s=302)
    _ring(d, R0 + dt.timedelta(seconds=320), worn_s=70, off_s=0, spo2_s=70)  # the next file, 18 s later
    e = loss_audit.wear_ends(str(d), "O2Ring-S")["ends"][0]
    assert e["tail_off"] is True and e["ppg2w_contradicted"] is True
    assert e["reason"] == "link-loss" and e["relink_gap_s"] == 19
    assert e["worn_end_at"] == e["end_at"] == (R0 + dt.timedelta(seconds=301)).isoformat()


def test_ring_end_doff_agreement_bound_is_inclusive_and_absence_is_none():
    last = dt.datetime(2026, 9, 23, 4, 22, 34)
    at = lambda s: last + dt.timedelta(seconds=s)  # noqa: E731
    assert loss_audit.ring_end_doff(True, at(-loss_audit.RING_DOFF_SPO2_AGREE_S), last) is True
    assert loss_audit.ring_end_doff(True, at(-loss_audit.RING_DOFF_SPO2_AGREE_S - 1), last) is False
    assert loss_audit.ring_end_doff(True, None, last) is False  # a tail whose second is not a time cannot place a doff
    assert loss_audit.ring_end_doff(False, at(0), last) is False
    assert loss_audit.ring_end_doff(None, None, last) is None


def test_a_ring_end_without_a_usable_ppg2w_witness_says_which_and_never_calls_a_doff(tmp_path):
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=30, off_s=10, spo2_s=40)  # 40 s of PPG2W: under the detector's minute
    os.remove(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_PPG2W.txt")
    e = loss_audit.wear_ends(str(d), "O2Ring-S")["ends"][0]
    assert e["ppg2w_file"] is None and e["ppg2w_unusable"] == "no paired PPG2W file"
    assert e["tail_off"] is None and e["reason"] == "quiet-end-unclassified" and e["ppg2w_contradicted"] is False
    _ring(d, R0, worn_s=30, off_s=10, spo2_s=40)
    e = loss_audit.wear_ends(str(d), "O2Ring-S")["ends"][0]
    assert e["ppg2w_unusable"] == "under 60 s of rows" and e["tail_off"] is None and e["doff_at"] is None


def test_an_spo2_file_with_no_stamped_row_is_not_an_end(tmp_path):
    d = _ring_dir(tmp_path)
    (d / "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv").write_text("Time,Oxygen Level,Pulse Rate,Motion\n")
    w = loss_audit.wear_ends(str(d), "O2Ring-S")
    assert w["ends"] == [
        {"file": "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv", "usable": False, "reason": "no stamped SpO2 row"}
    ]
    assert w["worn_end"] is None


def test_the_ring_last_row_is_read_from_the_tail_of_a_long_file(tmp_path):
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=0, off_s=0, spo2_s=3000)  # ~90 KB: the last stamp is beyond the first 4 KB
    assert loss_audit._last_stamp(str(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv")) == R0 + dt.timedelta(
        seconds=2999
    )


def test_a_ring_end_pairs_with_the_ppg2w_of_ITS_OWN_session(tmp_path):
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=120, off_s=40, spo2_s=119)  # session 1 ends doffed
    s2 = R0 + dt.timedelta(hours=1)
    _ring(d, s2, worn_s=90, off_s=0, spo2_s=90)  # session 2: no tail
    e1, e2 = loss_audit.wear_ends(str(d), "O2Ring-S")["ends"]
    assert e1["ppg2w_file"] == "Wellue_O2Ring-S_S8AW2100_20260922223924_PPG2W.txt" and e1["tail_off"] is True
    assert e2["ppg2w_file"] == "Wellue_O2Ring-S_S8AW2100_20260922233924_PPG2W.txt" and e2["tail_off"] is False


def test_only_the_ring_pays_for_the_ppg2w_pass(tmp_path, monkeypatch):
    monkeypatch.setattr(loss_audit.nightqc, "ppg2w_contact_quality", lambda d: pytest.fail("H10 read PPG2W"))
    assert loss_audit.wear_ends(str(tmp_path), "H10") == {"available": True, "ends": [], "worn_end": None}


def test_the_last_stamp_of_a_one_row_file_keeps_its_first_character(tmp_path):
    p = tmp_path / "one.csv"
    p.write_text("22:39:24 22/09/2026,97,58,0\n")
    assert loss_audit._last_stamp(str(p)) == dt.datetime(2026, 9, 22, 22, 39, 24)


def test_a_byte_that_is_not_utf8_in_the_tail_does_not_hide_the_last_stamp(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_bytes(b"Time,Oxygen Level,Pulse Rate,Motion\n22:39:24 22/09/2026,97,58,\xff\n22:39:25 22/09/2026,97,58,0\n")
    assert loss_audit._last_stamp(str(p)) == dt.datetime(2026, 9, 22, 22, 39, 25)
