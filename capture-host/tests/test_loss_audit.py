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
    gaps, _delays, span, cut = _split(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"))
    assert cut == 5.0 and span == 599.0  # 1 s rows ⇒ cut 5 s; a 3 s hole is not a gap
    with open(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"), "a") as fh:
        fh.write("garbled row\n2026-09-20T22:10:00.000;1\n")  # a torn row is skipped; the stream goes on
    gaps2, _delays2, span2, _ = _split(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"))
    assert span2 == 600.0 and len(gaps2) == len(gaps)
    empty = os.path.join(d, "empty.txt")
    open(empty, "w").write("Phone timestamp;x\n# a comment before the first stamp\n")
    assert _split(empty) == ([], [], 0.0, loss_audit._ni.GAP_S)
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
    # the entry gained provenance, additively: WHICH SIDE of the gap start the cause was found on, the
    # backward candidate kept as secondary evidence, any event deeper in the outage, and the fragment the
    # gap came from. `cause` is unchanged, which is the part that was ever the contract.
    assert v["gaps"] == [
        {
            "at": "2026-09-20T22:03:19",
            "s": 121.0,
            "cause": "daemon:not-worn drop",
            "cause_dir": "after",
            "backward_cause": "daemon:not-worn drop",
            "in_gap_cause": None,
            "file": "Polar_H10_0284_20260920220000_ECG.txt",
        }
    ]

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


def test_an_empty_file_does_not_stop_the_search_and_a_later_file_still_vouches(tmp_path, monkeypatch):
    """An empty file cannot vouch, but it must not END the search either — the night's evidence is in
    the next file. The order is PINNED rather than left to the filesystem: `glob` gives no ordering
    guarantee, so without this the case only arises when the directory happens to enumerate the empty
    file first, and the test would pass vacuously on a machine that enumerates the other way."""
    d = tmp_path / "captures" / "2026-08-04"
    d.mkdir(parents=True)
    empty = d / "Polar_VeritySense_0C30_20260804000001_PPI.txt"
    beats = d / "Polar_VeritySense_0C30_20260804230037_PPI.txt"
    empty.write_text("")
    beats.write_text(_PPI_BOX + "\n2026-08-04T23:00:57.020;0;0;393;30;1;1;1\n")
    monkeypatch.setattr(loss_audit.glob, "glob", lambda _pat: [str(empty), str(beats)])
    assert loss_audit._has_worn_evidence(str(d), "VeritySense") is True


def test_a_single_smallest_positive_interval_is_still_a_measured_value(tmp_path):
    """The test is `> 0`, not `> 1`: the question is whether the device wrote a measurement, not
    whether the measurement is large. A PP-interval of exactly 1 ms is implausible and is still data."""
    d = tmp_path / "captures" / "2026-08-04"
    d.mkdir(parents=True)
    (d / "Polar_VeritySense_0C30_20260804230037_PPI.txt").write_text(
        _PPI_BOX + "\n2026-08-04T23:00:57.020;0;0;1;30;1;1;1\n"
    )
    assert loss_audit._has_worn_evidence(str(d), "VeritySense") is True


def test_an_undecodable_byte_does_not_lose_the_night(tmp_path):
    """Capture files are written live and a torn write can leave a byte that is not valid UTF-8. The
    reader opens with errors="replace" so such a file is still READ; without it the decode raises
    UnicodeDecodeError, which is not an OSError and would escape the handler entirely."""
    d = tmp_path / "captures" / "2026-08-04"
    d.mkdir(parents=True)
    f = d / "Polar_VeritySense_0C30_20260804230037_PPI.txt"
    f.write_bytes(
        _PPI_BOX.encode() + b"\n2026-08-04T23:00:57.020;0;0;\xff\xfe;30;1;1;1"
        b"\n2026-08-04T23:00:58.020;0;0;393;30;1;1;1\n"
    )
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
    out = loss_audit.wear_by_device(
        str(d),
        [
            {"name": "H10 chest", "model": "H10"},  # named → keyed by the name
            {"model": "VeritySense"},  # unnamed → keyed by the model, as audit_night does
            {"name": "Athena", "model": "Athena-9"},  # unknown model → no wear rule → omitted
            {"name": "No model"},  # no model at all → omitted
            "not a dict",  # junk → skipped, not fatal
        ],
    )
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
    # `stream_scan`, not `stream_gaps_split`: the audit needs each fragment's ENDPOINTS to judge a
    # boundary, so that is the call it makes. Same contract — an unreadable primary does not end the night.
    monkeypatch.setattr(loss_audit, "stream_scan", lambda p: (_ for _ in ()).throw(OSError("eio")))
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
    gaps, _delays, span, cut = _split(str(p))
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
    real = loss_audit.stream_scan

    def eio_for_the_h10(p):
        if "H10" in os.path.basename(p):
            raise OSError("eio")
        return real(p)

    monkeypatch.setattr(loss_audit, "stream_scan", eio_for_the_h10)
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
    assert g == {
        "at": "2026-09-20T22:03:19",
        "s": 61.0,
        "cause": "link:dbus busy",  # the window's edge still names it
        "cause_dir": "before",
        "backward_cause": "link:dbus busy",
        "in_gap_cause": None,
        "file": "Polar_H10_0284_20260920220000_ECG.txt",
    }
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
    assert e["doff_at"] == (R0 + dt.timedelta(seconds=120)).isoformat()
    # the worn interval ends at the EARLIER witness, here the SpO2 file's last row, so that file covers it
    assert e["worn_end_at"] == e["end_at"] == (R0 + dt.timedelta(seconds=118)).isoformat()
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


# ── a DELAY is not a LOSS: the device clock decides (H10 2026-09-17 → 09-23: 16 host gaps, 0 samples missing) ──
PERIOD_NS = 8_000_000  # 125 Hz: an even period, so 1.5 periods is a whole number of ns and the edge is exact


def _polar(path, rows, host_jumps=(), dev_steps=None, torn_at=None, dev_last=False, extra_bytes=None):
    """A Polar-shaped stream at 125 Hz. `host_jumps` = {row: seconds} added to the HOST clock from that row on;
    `dev_steps` = {row: ns} replacing that row's DEVICE step (default one period); row `torn_at` has no device
    value; `dev_last` puts the device column LAST in the header; `extra_bytes` = {row: raw bytes appended}."""
    host = 0.0
    dev = 1_000_000_000_000_000_000
    hdr = (
        "Phone timestamp;ecg [uV];sensor timestamp [ns]"
        if dev_last
        else "Phone timestamp;sensor timestamp [ns];ecg [uV]"
    )
    with open(path, "wb") as fh:
        fh.write((hdr + "\n").encode())
        for i in range(rows):
            host += dict(host_jumps).get(i, 0.0) + (PERIOD_NS / 1e9 if i else 0.0)
            if i:
                dev += (dev_steps or {}).get(i, PERIOD_NS)
            h = (T0 + dt.timedelta(seconds=host)).isoformat(timespec="milliseconds")
            dv = "" if i == torn_at else str(dev)
            row = f"{h};100;{dv}" if dev_last else f"{h};{dv};100"
            fh.write(row.encode() + (extra_bytes or {}).get(i, b"") + b"\n")


def _split(path):
    """(gaps, delays, span, cut) — the tuple shorthand these tests read. It lived in `loss_audit` as
    `stream_gaps_split` until `audit_night` began calling `stream_scan` for each fragment's endpoints,
    at which point nothing in production called the projection and `find_unwired` said so."""
    sc = loss_audit.stream_scan(str(path))
    return sc["gaps"], sc["delays"], sc["span"], sc["cut"]


def test_a_host_gap_the_device_clock_does_not_see_is_a_delay_not_a_loss(tmp_path):
    p = tmp_path / "Polar_H10_0284_20260920220000_ECG.txt"
    _polar(p, 15000, host_jumps={6000: 5.0})  # the batch arrived 5 s late; every sample is still there
    gaps, delays, span, cut = _split(p)
    assert gaps == [] and len(delays) == 1 and delays[0][2] == PERIOD_NS


def test_a_host_gap_the_device_clock_also_jumps_is_a_loss(tmp_path):
    p = tmp_path / "loss.txt"
    _polar(p, 15000, host_jumps={6000: 43.5}, dev_steps={6000: int(43.5e9) + PERIOD_NS})  # samples missing
    gaps, delays, _, _ = _split(p)
    assert delays == [] and len(gaps) == 1 and gaps[0][1] >= 43.0


def test_the_delay_edge_is_one_and_a_half_periods_exclusive_and_a_zero_step_is_a_delay(tmp_path):
    cases = {"edge": int(1.5 * PERIOD_NS), "under": int(1.5 * PERIOD_NS) - 1, "zero": 0}
    got = {}
    for name, step in cases.items():
        p = tmp_path / f"{name}.txt"
        _polar(p, 15000, host_jumps={6000: 5.0}, dev_steps={6000: step})
        gaps, delays, _, _ = _split(p)
        got[name] = "delay" if delays and not gaps else "gap" if gaps and not delays else (gaps, delays)
    assert got == {"edge": "gap", "under": "delay", "zero": "delay"}


def test_the_period_is_learned_at_exactly_the_200th_positive_step(tmp_path):
    assert loss_audit._PERIOD_ROWS == 200
    at = tmp_path / "at.txt"
    _polar(at, 3000, host_jumps={200: 5.0})  # the 200th step is row 200: the period is known before its gap is judged
    before = tmp_path / "before.txt"
    _polar(before, 3000, host_jumps={199: 5.0})  # one row earlier: no period yet, so a host gap stays a gap
    assert (len(_split(at)[1]), len(_split(before)[0])) == (1, 1)


def test_the_period_is_the_MEDIAN_positive_step_and_zero_steps_are_not_counted(tmp_path):
    # Steps alternate 4 ms / 12 ms: the median of the positive steps is 12 ms (edge 18 ms), a lower quantile would
    # be 4 ms (edge 6 ms). Two of every three steps are ZERO (repeated device stamps): counted, they would make
    # the median 0 and nothing could ever be a delay. The gap's device step is 10 ms: a delay only under the median.
    steps = {}
    for i in range(1, 3000):
        steps[i] = 0 if i % 3 else (4_000_000 if (i // 3) % 2 else 12_000_000)
    steps[2500] = 10_000_000
    p = tmp_path / "median.txt"
    _polar(p, 3000, host_jumps={2500: 5.0}, dev_steps=steps)
    gaps, delays, _, _ = _split(p)
    assert gaps == [] and [d[2] for d in delays] == [10_000_000]


def test_a_host_gap_exactly_at_the_cut_is_not_a_gap(tmp_path):
    p = tmp_path / "1hz.txt"
    _stream(
        str(p), ((300, 304),)
    )  # 1 s rows, no device clock: the cut is 5 × the 1 s cadence, and rows 299 → 304 sit exactly on it
    gaps, delays, _, cut = _split(p)
    assert cut == 5.0 and gaps == [] and delays == []


def test_the_device_column_is_found_by_name_last_or_second_and_a_bad_byte_is_not_fatal(tmp_path):
    last = tmp_path / "last.txt"
    _polar(last, 15000, host_jumps={6000: 5.0}, dev_last=True, extra_bytes={100: b"\xff"})
    padded = tmp_path / "padded.txt"
    _polar(padded, 15000, host_jumps={6000: 5.0})
    raw = padded.read_bytes().replace(b"sensor timestamp [ns]", b"sensor timestamp [ns]  ", 1)
    padded.write_bytes(raw)  # a header column name with trailing spaces is still that column
    torn_first = tmp_path / "torn_first.txt"
    _polar(torn_first, 15000, host_jumps={6000: 5.0}, torn_at=0)  # the first row carries no device time
    for f in (last, torn_first, padded):
        gaps, delays, _, _ = _split(f)
        assert gaps == [] and len(delays) == 1, f.name


def test_the_audit_publishes_each_delay_exactly_and_never_counts_it_as_lost(tmp_path):
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    f = d / "Polar_H10_0284_20260920220000_ECG.txt"
    # 26.5 s lands the rows either side of the jump 27 whole seconds apart: 27/60 and 27/61 round apart at one
    # decimal (0.5 vs 0.4), so a wrong divisor cannot pass by rounding to the same number.
    _polar(f, 20000, host_jumps={6000: 26.5, 12000: 43.5}, dev_steps={12000: int(43.5e9) + PERIOD_NS})
    gaps, delays, _, _ = _split(f)
    assert round(delays[0][1] / 60.0, 1) != round(delays[0][1] / 61.0, 1), (
        "the plant no longer discriminates the divisor"
    )
    v = loss_audit.audit_night(str(d), DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    (t, g, step) = delays[0]
    assert v["delays"] == [{"at": t.isoformat(timespec="seconds"), "s": round(g, 1), "device_ns": PERIOD_NS}]
    assert isinstance(v["delays"][0]["s"], float) and v["delays"][0]["s"] >= 27.0
    assert v["delayed_min"] == round(g / 60.0, 1) and v["delayed_min"] != round(g / 60.0, 2)
    assert len(v["gaps"]) == 1 and v["lost_min"] == round(gaps[0][1] / 60.0, 1)
    assert v["fragments"] == 2  # a delay does not split the stream


def test_a_ring_tail_that_starts_before_the_spo2_stream_stops_ends_the_worn_interval_there(tmp_path):
    # Inside the 30 s agreement bound the off-finger tail can precede the SpO2 file's last row: -10 s here.
    d = _ring_dir(tmp_path)
    _ring(d, R0, worn_s=100, off_s=40, spo2_s=111)  # tail starts +100, SpO2 last row +110
    (e,) = loss_audit.wear_ends(str(d), "O2Ring-S")["ends"]
    assert e["reason"] == "doff" and e["doff_at"] == (R0 + dt.timedelta(seconds=100)).isoformat()
    assert e["worn_end_at"] == e["doff_at"] and e["end_at"] == (R0 + dt.timedelta(seconds=110)).isoformat()


# ── the operator's time sync is its own cause (2026-09-24 22:00:54: one press, two H10 FAILs) ─────────────────
_H10_ADDR = "24:AC:AC:02:84:96"


def _journal_lines(*lines):
    class R:
        returncode = 0
        stdout = "\n".join(lines) + "\n"

    return lambda *a, **k: R()


def _pause(hms):
    return f"2026-09-24T{hms}-04:00 vigil python[1]: 2026-09-24 {hms},000 INFO Polar {_H10_ADDR}: offline-recording op — live capture paused"


_POST = (
    "2026-09-24T22:01:17-04:00 vigil python[1]: 2026-09-24 22:01:17,076 INFO 127.0.0.1 [24/Sep/2026:22:00:54 -0400] "
    '"POST /api/timesync/all HTTP/1.1" 200 1022 "http://vigil.local/monitor" "Mozilla/5.0"'
)


def test_a_time_sync_is_dated_from_its_request_start_and_owns_the_pauses_it_causes():
    run = _journal_lines(
        _pause("22:00:54"),  # at the request start: inside
        _pause("22:01:09"),
        "-- Boot 0f3c9a7e1d2b4c5a --",  # journalctl marks a reboot MID-stream; the lines after it still count
        _POST,  # logged at completion 22:01:17; the window runs to 22:02:17
        _pause("22:02:17"),  # exactly at the edge: inside
        _pause("22:02:18"),  # one second past it: the daemon's again
        '2026-09-24T22:03:00-04:00 vigil python[1]: 127.0.0.1 "POST /api/timesync/all HTTP/1.1" 200 0',  # no brackets
        '2026-09-24T22:04:00-04:00 vigil python[1]: 127.0.0.1 [24/Xyz/2026:22:03:59 -0400] "POST /api/timesync/all"',
    )
    ev = loss_audit.read_journal(("Polar H10 02849638", _H10_ADDR), T0, T0 + dt.timedelta(hours=8), run=run)
    at = lambda hms: dt.datetime.fromisoformat(f"2026-09-24T{hms}")  # noqa: E731
    assert ev == [
        (at("22:00:54"), loss_audit.OPERATOR_TIMESYNC),
        (at("22:00:54"), loss_audit.OPERATOR_TIMESYNC),
        (at("22:01:09"), loss_audit.OPERATOR_TIMESYNC),
        (at("22:02:17"), loss_audit.OPERATOR_TIMESYNC),
        (at("22:02:18"), "daemon:pull paused live"),
    ]
    # the H10 gap that opened at 22:01:08 is the operator's, not the daemon's (nor unattributed)
    assert loss_audit.attribute_gaps([(at("22:01:08"), 20.6)], ev) == [
        (at("22:01:08"), 20.6, loss_audit.OPERATOR_TIMESYNC)
    ]


def test_the_access_start_parser_refuses_what_it_cannot_read():
    assert loss_audit._access_start("no brackets here") is None
    assert loss_audit._access_start("[24/Xyz/2026:22:00:54 -0400]") is None
    assert loss_audit._access_start("x [01/Jan/2027:00:00:05 +0100] y") == dt.datetime(2027, 1, 1, 0, 0, 5)
    assert loss_audit._access_start("[31/Dec/2026:23:59:59 -0400]") == dt.datetime(2026, 12, 31, 23, 59, 59)


# ---------------------------------------------------------------------------------------------------
# THE AUDIT'S OWN POPULATION — every fragment, and a cause the daemon logs AFTER the gap starts.
# residue 2026-09-24-loss-audit-audits-only-the-largest-file
#        2026-09-25-loss-audit-attribution-looks-only-backward
# ---------------------------------------------------------------------------------------------------


def _frag(path, rows, *, host0=0.0, dev0=1_000_000_000_000_000_000, period=PERIOD_NS):
    """One fragment of a Polar stream, its host clock and device counter both starting where told — so a
    caller can place two files a known distance apart on BOTH clocks and the boundary becomes judgeable."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];ecg [uV]\n")
        for i in range(rows):
            h = (T0 + dt.timedelta(seconds=host0 + i * period / 1e9)).isoformat(timespec="milliseconds")
            fh.write(f"{h};{dev0 + i * period};100\n")


def _two_fragment_night(tmp_path, *, boundary_s, dev_advance_s, name="2026-09-20"):
    """A night whose primary stream is TWO files. `boundary_s` is the host gap between the last row of the
    first and the first row of the second; `dev_advance_s` is what the DEVICE counter advanced across that
    boundary — equal to the host gap means real loss, ~0 means the second file resumed where the first
    stopped and the samples were merely late."""
    d = tmp_path / "captures" / name
    d.mkdir(parents=True)
    rows = 15000  # 120 s at 125 Hz
    span1 = (rows - 1) * PERIOD_NS / 1e9
    _frag(str(d / "Polar_H10_0284_20260920220000_ECG.txt"), rows)
    _frag(
        str(d / "Polar_H10_0284_20260920220400_ECG.txt"),
        rows,
        host0=span1 + boundary_s,
        dev0=1_000_000_000_000_000_000 + int((span1 + dev_advance_s) * 1e9),
    )
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    return str(d)


def test_PLANT_a_cause_logged_AFTER_the_gap_start_is_attributed(tmp_path):
    """residue 2026-09-25. The gap's start is the stream's LAST DELIVERED ROW, and the daemon logs the
    action that caused it AFTER that row — measured on the H10 over 2026-09-17→23, all 39 real-loss gaps
    had the pause line 1-3 s after the start and NONE before it, so all 39 read `unattributed`. The
    geometry here is the recorded 2026-09-21T00:17:54 case: an 11.8 s step with the pause at 00:17:55.895.
    """
    t0 = dt.datetime(2026, 9, 21, 0, 17, 54)
    gaps = [(t0, 11.8)]
    events = [(t0 + dt.timedelta(seconds=1.895), "daemon:pull paused live")]
    got = loss_audit.attribute_gaps(gaps, events)
    assert got[0][2] == "daemon:pull paused live", (
        "a daemon-caused loss read as unattributed inflates SOLID-NIGHT's unattributed leg with the "
        "daemon's own designed behaviour",
        got,
    )


def test_PLANT_every_fragment_of_the_primary_stream_is_audited(tmp_path):
    """residue 2026-09-24. `audit_night` audited ONE file per device — the largest — so on a fragmented
    night the ledger read as the whole night while 18.7-55.2 % of the recorded span went unexamined
    (measured on vigil: 2026-09-10 H10 4 files 53.7 % unaudited; 2026-09-19 Verity 5 files 55.2 %;
    2026-09-05 ring 32 files 18.7 %). Two equal fragments here, so `max(getsize)` cannot pick 'the' one.
    """
    d = _two_fragment_night(tmp_path, boundary_s=60.0, dev_advance_s=60.0)
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    dev = a["devices"]["Polar H10 0284"]
    assert [f["file"] for f in dev["files"]] == [
        "Polar_H10_0284_20260920220000_ECG.txt",
        "Polar_H10_0284_20260920220400_ECG.txt",
    ], dev
    assert dev["span_min"] == pytest.approx(2 * 119.992 / 60.0, abs=0.05), (
        "the span must be the sum over fragments, not one file's",
        dev["span_min"],
    )


def test_PLANT_the_gap_BETWEEN_two_fragments_is_itself_audited(tmp_path):
    """The row's own point: a fragment boundary is a delivery event, so the gap between two fragments is a
    loss that no per-file scan can see and 'sum the files' gaps' would miss. Judged like any other host
    gap — by the DEVICE counter (#3157): advancing across the boundary by the whole 60 s means the samples
    are gone."""
    d = _two_fragment_night(tmp_path, boundary_s=60.0, dev_advance_s=60.0)
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    dev = a["devices"]["Polar H10 0284"]
    boundary = [g for g in dev["gaps"] if g.get("boundary")]
    assert len(boundary) == 1 and boundary[0]["s"] == pytest.approx(60.0, abs=0.1), dev["gaps"]
    assert dev["lost_min"] == pytest.approx(1.0, abs=0.05), dev["lost_min"]


def test_CONTROL_a_boundary_the_device_counter_did_not_advance_across_is_a_DELAY(tmp_path):
    """#3157 at the boundary, and the reason `boundary_gap` exists rather than "sum the files' gaps".

    The second fragment resumes where the first stopped ON THE DEVICE CLOCK: the samples were not lost, the
    delivery was. A 60 s host wait with a ~0 s counter advance must land in `delays` and leave `lost_min` at
    zero, exactly as the same shape inside one file does."""
    d = _two_fragment_night(tmp_path, boundary_s=60.0, dev_advance_s=0.0)
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    dev = a["devices"]["Polar H10 0284"]
    assert dev["boundary_gaps"] == 0 and dev["lost_min"] == 0.0, dev
    assert dev["delayed_min"] == pytest.approx(1.0, abs=0.05), dev["delayed_min"]
    assert [g for g in dev["gaps"] if g.get("boundary")] == [], dev["gaps"]


def test_CONTROL_a_single_file_night_is_audited_exactly_as_before(tmp_path):
    """The population change must not move a night that was never fragmented. Every number the audit
    publishes for a one-file device is what a scan of that one file says, and no boundary is invented."""
    d = _night(tmp_path, holes=((200, 320),))
    a = loss_audit.audit_night(d, DEV, journal=lambda *a: [])
    dev = a["devices"]["Polar H10 0284"]
    sc = loss_audit.stream_scan(os.path.join(d, "Polar_H10_0284_20260920220000_ECG.txt"))
    assert dev["boundary_gaps"] == 0, dev
    assert [f["file"] for f in dev["files"]] == ["Polar_H10_0284_20260920220000_ECG.txt"], dev
    assert dev["span_min"] == round(sc["span"] / 60.0, 1), dev
    assert dev["fragments"] == len(sc["gaps"]) + 1, dev
    assert len(dev["gaps"]) == len(sc["gaps"]), dev


def test_CONTROL_the_verdict_object_shape_is_untouched_on_a_fragmented_night(tmp_path):
    """The audit body grew; the VERDICT must not. Its population still counts devices by `file`, which is
    why that key kept its old name and meaning even though `files` is now the audited population."""
    d = _two_fragment_night(tmp_path, boundary_s=60.0, dev_advance_s=60.0)
    v = loss_audit.night_verdict(loss_audit.audit_night(d, DEV, journal=lambda *a: []), night_dir=d)
    js_validate(v)
    assert set(v) >= {
        "schema",
        "gate",
        "status",
        "population",
        "criterion",
        "result",
        "evidence",
        "reason",
        "producedBy",
        "at",
    }, sorted(v)
    assert v["population"] == {"checked": 1, "eligible": 1, "excluded": 0}, v["population"]


def test_boundary_gap_REFUSES_to_call_a_wait_a_delay_without_the_counters_word(tmp_path):
    """Three ways the counter cannot answer, all of which must fall to `loss` — the direction that cannot
    silently forgive a real hole. A reconnect RESETS the counter (§🔒 §7: a resync is a change of clock),
    so a backwards step is not a small step; it is a different clock, and it bounds nothing."""
    t = dt.datetime(2026, 9, 20, 22, 0, 0)
    prev = {"last": t, "cut": 1.0, "period_ns": PERIOD_NS, "last_dev": 1_000_000_000_000_000_000}
    nxt_ok = {"first": t + dt.timedelta(seconds=60), "first_dev": 1_000_000_000_000_000_000}
    assert loss_audit.boundary_gap(prev, nxt_ok)[0] == "delay"  # the counter held its place
    assert loss_audit.boundary_gap({**prev, "last_dev": None}, nxt_ok)[0] == "loss"  # no counter here
    assert loss_audit.boundary_gap(prev, {**nxt_ok, "first_dev": None})[0] == "loss"  # none there
    assert loss_audit.boundary_gap({**prev, "period_ns": None}, nxt_ok)[0] == "loss"  # no period learnt
    back = {**nxt_ok, "first_dev": 1_000_000_000_000_000_000 - 10**9}  # counter RESET
    assert loss_audit.boundary_gap(prev, back)[0] == "loss"
    assert loss_audit.boundary_gap(prev, {**nxt_ok, "first": t + dt.timedelta(seconds=0.5)}) is None
    assert loss_audit.boundary_gap({**prev, "last": None}, nxt_ok) is None
    assert loss_audit.boundary_gap(prev, {**nxt_ok, "first": None}) is None


def test_an_event_deep_inside_the_outage_is_recorded_but_never_the_cause():
    """`in_gap_cause`. An event that merely happens during an outage is not its cause — the measurement is
    that the causing line lands 1-3 s after the start — so a `dbus busy` 100 s into a 121 s gap is published
    where a reader can see it and loses to a `not-worn drop` 1 s before the start."""
    t0 = T0 + dt.timedelta(seconds=199)
    ev = [(t0 - dt.timedelta(seconds=1), "daemon:not-worn drop"), (t0 + dt.timedelta(seconds=100), "link:dbus busy")]
    r = loss_audit.attribute_gaps_detail([(t0, 121.0)], ev)[0]
    assert r["cause"] == "daemon:not-worn drop" and r["cause_dir"] == "before", r
    assert r["in_gap_cause"] == "link:dbus busy", r


# ---------------------------------------------------------------------------------------------------
# THE RING'S STALLS — residue 2026-09-25-ring-stalls-count-as-loss-without-a-device-clock
#
# ⚠️ THAT ROW'S TITLE USES WORDING THE OWNER HAS REJECTED ON SIGHT ("o2 has crystal and time sync. how
# is that not clock?", 2026-08-17). The ring HAS a clock: an onboard RTC we deliberately discipline with
# `SET_UTC_TIME (0xC0)`. What its EXPORTED AXIS carries is no per-sample clock READINGS — the raw streams'
# `sensor timestamp [ns]` is drawn, `sample_index x 7,953,045 ns`, one delta value at 100.0 % across 16
# files — and the `_SPO2.csv` primary carries no device column at all (`Time,Oxygen Level,Pulse Rate,
# Motion`). So the delay test, which compares a host gap against a device-counter step, has nothing to
# read, and every event-loop stall fell to `loss` by default.
#
# The witness the ring DOES carry is `duration_s` in the 0x04 frames (`OXYFRAME.txt`): a counter of
# SECONDS OF SIGNAL PRODUCED, not seconds of time. That asymmetry is exactly what makes it usable here —
# a stall the ring produced signal across advanced it, a stall the ring was silent through did not — and
# it is also the limit: "advanced by 13" and "13 s of time passed" are different claims, and only the
# first is available.
# ---------------------------------------------------------------------------------------------------

_OXY_HDR = (
    "Phone timestamp;duration_s;pi_pct;motion;spo2;pr;contact;battery_pct;batt_state;flag;"
    "ppg_n;ppg_dur_step;ppg_offset;flag_raw;alarm_raw;run_status\n"
)


def _oxyframe(d, start, secs, *, stall_at=None, stall_s=0, freeze=False, dur0=0):
    """An `OXYFRAME.txt` for a ring session: one frame per second carrying `duration_s`.

    `stall_at`/`stall_s` cut the frames out for that window, as an event-loop stall does. `freeze` keeps
    the counter at its pre-stall value when delivery resumes — the ring produced NOTHING across the
    stall — where the default resumes at the value continuous production would have reached.
    """
    stamp = start.strftime("%Y%m%d%H%M%S")
    with open(d / f"Wellue_O2Ring-S_S8AW2100_{stamp}_OXYFRAME.txt", "w") as fh:
        fh.write(_OXY_HDR)
        for sec in range(secs):
            if stall_at is not None and stall_at <= sec < stall_at + stall_s:
                continue
            dur = dur0 + (min(sec, stall_at) if (freeze and stall_at is not None and sec >= stall_at) else sec)
            t = (start + dt.timedelta(seconds=sec)).isoformat(timespec="milliseconds")
            fh.write(f"{t};{dur};25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n")


def _ring_stall_night(tmp_path, *, witness="advancing", stall_at=100, stall_s=12):
    """A ring night whose SpO2 primary has one stall, with the 0x04 signal witness beside it (or not)."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    start = dt.datetime(2026, 9, 22, 22, 39, 24)
    with open(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv", "w") as fh:
        fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        for sec in range(300):
            if stall_at <= sec < stall_at + stall_s:
                continue
            fh.write((start + dt.timedelta(seconds=sec)).strftime("%H:%M:%S %d/%m/%Y") + ",97,58,0\n")
    if witness != "absent":
        _oxyframe(d, start, 300, stall_at=stall_at, stall_s=stall_s, freeze=(witness == "frozen"))
    return str(d)


RING_DEV = [{"name": "Ring", "model": "O2Ring-S"}]


def test_PLANT_a_ring_stall_the_signal_counter_advanced_across_is_a_DELAY(tmp_path):
    """The ring kept producing signal through the stall — `duration_s` advanced by the stall's length — so
    the seconds exist and what was lost was the delivery, not the signal. Calling it loss overstates the
    night's hole by every event-loop stall the box ever had."""
    d = _ring_stall_night(tmp_path, witness="advancing")
    dev = loss_audit.audit_night(d, RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert dev["lost_min"] == 0.0, ("a stall the ring produced signal across is not loss", dev)
    assert dev["gaps"] == [], dev["gaps"]  # it left `gaps` entirely, as an in-file delay does
    # the ledger publishes minutes to one decimal, so 13 s is 0.2 — asserted as published, not as 13/60
    assert dev["delayed_min"] == 0.2, dev["delayed_min"]


def test_PLANT_a_ring_stall_the_counter_did_NOT_advance_across_is_a_LOSS(tmp_path):
    """The mirror: the counter is frozen across the stall, so the ring produced nothing and those seconds
    of signal do not exist anywhere. That IS loss, and it must still read as loss."""
    d = _ring_stall_night(tmp_path, witness="frozen")
    dev = loss_audit.audit_night(d, RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert dev["lost_min"] == 0.2, dev
    assert [g["witness"] for g in dev["gaps"]] == ["silence"], dev["gaps"]
    # 1 s of the 13 was produced — under the gap minus one count, so the rest is signal that never was
    assert dev["gaps"][0]["witness_advance_s"] == 1.0, dev["gaps"]
    assert dev["unwitnessed_min"] == 0.0, dev


def test_PLANT_a_ring_stall_with_no_witness_is_UNKNOWN_and_never_loss_by_default(tmp_path):
    """No `OXYFRAME.txt` beside the primary: nothing on the device side can say whether those seconds were
    produced. The honest output is that the gap is unwitnessed, with its minutes reported under their own
    name — not folded into `lost_min`, which is a measurement of signal that demonstrably did not exist."""
    d = _ring_stall_night(tmp_path, witness="absent")
    dev = loss_audit.audit_night(d, RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert dev["lost_min"] == 0.0, ("loss by default is the defect", dev)
    assert dev["unwitnessed_min"] == 0.2, dev
    assert [g["witness"] for g in dev["gaps"]] == ["unwitnessed"], dev["gaps"]
    # the gap is still PUBLISHED with its length and cause — reported, just not claimed as lost signal
    assert dev["gaps"][0]["s"] == 13.0 and dev["gaps"][0]["witness_advance_s"] is None, dev["gaps"]


def test_CONTROL_a_POLAR_stream_with_no_device_column_does_not_borrow_the_rings_witness(tmp_path):
    """THE SCOPING CONTROL, and it caught a real error in the first draft of this change. Gating the
    witness on "this scan found no counter" fires for an H10 file that carries no device column — an older
    night, a torn header — and `duration_s` is the RING's production counter, which says nothing whatever
    about an H10. So the gate is the ring's own primary. A Polar stream keeps exactly the behaviour it had:
    its gaps are loss, and no witness key appears on them."""
    d = _night(tmp_path, holes=((200, 320),))  # `_stream` writes "Phone timestamp;x" — no counter
    (tmp_path / "captures" / "2026-09-20" / "Wellue_O2Ring-S_S8AW2100_20260920220000_OXYFRAME.txt").write_text(
        _OXY_HDR + "2026-09-20T22:03:19.000;0;25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n"
    )
    dev = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert dev["lost_min"] == pytest.approx(121 / 60.0, abs=0.05), dev
    assert dev["unwitnessed_min"] == 0.0, dev
    assert all("witness" not in g for g in dev["gaps"]), dev["gaps"]


def test_a_ring_counter_that_RESET_across_the_gap_is_unwitnessed_not_silence(tmp_path):
    """A new recording session zeroes `duration_s`, so a backwards step is not a small advance — it is a
    different count, and nothing about the old value bounds the new one. Reading that as silence would
    turn every ring session restart into invented signal loss (§🔒 §7, the same rule `boundary_gap` keeps
    for a device counter that goes backwards)."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    start = dt.datetime(2026, 9, 22, 22, 39, 24)
    with open(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv", "w") as fh:
        fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        for sec in range(300):
            if 100 <= sec < 112:
                continue
            fh.write((start + dt.timedelta(seconds=sec)).strftime("%H:%M:%S %d/%m/%Y") + ",97,58,0\n")
    _oxyframe(d, start, 100, dur0=500)  # before: counting from 500
    _oxyframe(d, start + dt.timedelta(seconds=112), 188, dur0=0)  # after: a fresh session at 0
    dev = loss_audit.audit_night(str(d), RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert [g["witness"] for g in dev["gaps"]] == ["unwitnessed"], dev["gaps"]
    assert dev["lost_min"] == 0.0 and dev["unwitnessed_min"] == 0.2, dev


def test_the_signal_witness_survives_a_torn_row_and_an_unreadable_frame_file(tmp_path):
    """A torn row carries no counter and is skipped, not read as a zero (∅). An unreadable frame file is
    not the absence of a witness either — the others still answer."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    start = dt.datetime(2026, 9, 22, 22, 39, 24)
    with open(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_OXYFRAME.txt", "w") as fh:
        fh.write(_OXY_HDR)
        fh.write(f"{start.isoformat(timespec='milliseconds')};0;25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n")
        fh.write(f"{(start + dt.timedelta(seconds=1)).isoformat(timespec='milliseconds')};;25.5\n")  # torn
        fh.write("\n")  # a blank line: no fields at all
        fh.write("# a comment the writer left;7\n")  # two fields, but no stamp to read
        fh.write(
            f"{(start + dt.timedelta(seconds=2)).isoformat(timespec='milliseconds')};2;25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n"
        )
    (d / "Wellue_O2Ring-S_S8AW2100_20260922224000_OXYFRAME.txt").mkdir()  # unreadable: a directory
    w = loss_audit.signal_witness(str(d))
    assert [v for _t, v in w] == [0, 2], w


def test_a_gap_the_witness_does_not_BRACKET_is_unwitnessed(tmp_path):
    """The counter can only speak about a span it has a reading on either side of. A gap before its first
    frame — or after its last — gets no verdict rather than a guess, which is the same refusal as a missing
    file and for the same reason: the audit may not invent the ring's production."""
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    w = [(t + dt.timedelta(seconds=k), k) for k in range(100, 200)]
    assert loss_audit.witness_judges(w, t, 13.0) == ("unwitnessed", None)  # before the first
    assert loss_audit.witness_judges(w, t + dt.timedelta(seconds=250), 13.0) == ("unwitnessed", None)
    # and the control: a gap it DOES bracket gets a verdict
    verdict_, advance = loss_audit.witness_judges(w, t + dt.timedelta(seconds=120), 13.0)
    assert (verdict_, advance) == ("delay", 13.0), (verdict_, advance)


# ── the witness's own edges ─────────────────────────────────────────────────────────────────────────
# Each of these pins one boundary of `witness_judges` or one refusal of `signal_witness`. They exist
# because the diff-scoped mutation gate found every one of them unobserved: the three plants above prove
# the mechanism works on the shapes the corpus shows, and say nothing about where its edges are.


def test_the_witness_can_answer_from_its_very_FIRST_reading(tmp_path):
    """`i < 0`, not `i <= 0` or `i < 1`. The reading at or before the gap start may BE the first row the
    witness has — a stall in the opening seconds of a session — and that reading is as good as any other.
    Refusing it would make the first gap of every night unwitnessed."""
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    w = [(t, 0)] + [(t + dt.timedelta(seconds=k), k) for k in range(20, 40)]
    verdict_, advance = loss_audit.witness_judges(w, t, 20.0)  # bracketed by index 0 and a later row
    assert (verdict_, advance) == ("delay", 20.0), (verdict_, advance)


def test_a_counter_that_did_not_move_at_all_is_SILENCE_not_unwitnessed(tmp_path):
    """`advance < 0`, not `<= 0` or `< 1`. Zero advance is the counter's clearest possible statement — the
    ring produced nothing across that span — and it is the whole reason this witness works. Only a
    NEGATIVE step is unjudgeable, because that is a new session's count rather than a small one."""
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    w = [(t + dt.timedelta(seconds=k), 500) for k in range(0, 40)]  # frozen at 500 throughout
    assert loss_audit.witness_judges(w, t + dt.timedelta(seconds=5), 20.0) == ("silence", 0.0)


def test_an_advance_EXACTLY_one_count_short_of_the_gap_is_still_a_delay(tmp_path):
    """`>=`, not `>`. The counter is 1 Hz, so it can only ever agree with a gap to within one count —
    `RING_WITNESS_TOL_S` is that quantum, and a gap it accounts for to exactly the quantum is accounted
    for. Which side the boundary falls on is a decision about the counter's resolution, not an accident."""
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    g = 13.0
    exact = g - loss_audit.RING_WITNESS_TOL_S  # 12.0 s of produced signal
    w = [(t, 100), (t + dt.timedelta(seconds=g), 100 + int(exact))]
    assert loss_audit.witness_judges(w, t, g) == ("delay", exact)
    # and one count less is not: the boundary is a decision, so it is asserted from both sides
    w2 = [(t, 100), (t + dt.timedelta(seconds=g), 100 + int(exact) - 1)]
    assert loss_audit.witness_judges(w2, t, g) == ("silence", exact - 1)


def test_the_witness_reads_a_row_of_EXACTLY_two_fields(tmp_path):
    """`len(parts) < 2`, not `<= 2` or `< 3`. The stamp and the counter are the only two fields this needs,
    so a row trimmed to exactly those two is usable — and a writer that ever emits a narrower frame row
    would otherwise have its counter silently dropped."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    (d / "Wellue_O2Ring-S_S8AW2100_20260922223924_OXYFRAME.txt").write_text(
        _OXY_HDR + f"{t.isoformat(timespec='milliseconds')};7\n"
    )  # exactly two fields
    assert loss_audit.signal_witness(str(d)) == [(t, 7)]


def test_the_witness_replaces_an_undecodable_byte_rather_than_dying_on_it(tmp_path):
    """`errors="replace"`, kept. A frame file with a torn byte is a live-journal shape, and the rows either
    side of it still carry counters — a strict decode would raise inside the audit and take the whole
    night's witness with it."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    p = d / "Wellue_O2Ring-S_S8AW2100_20260922223924_OXYFRAME.txt"
    with open(p, "wb") as fh:
        fh.write(_OXY_HDR.encode())
        fh.write(f"{t.isoformat(timespec='milliseconds')};1;25.5\n".encode())
        fh.write(b"\xff\xfe not a stamp;2\n")  # invalid UTF-8 mid-file
        fh.write(f"{(t + dt.timedelta(seconds=2)).isoformat(timespec='milliseconds')};3;25.5\n".encode())
    assert [v for _t, v in loss_audit.signal_witness(str(p.parent))] == [1, 3]


def test_one_unreadable_frame_file_does_not_stop_the_witness_reading_the_REST(tmp_path):
    """`continue`, never `break`. The unreadable file is named so it sorts FIRST — under `break` the
    readable session after it is never opened and the night reads as having no witness at all, which is
    the difference between "cannot say" and "did not look"."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    t = dt.datetime(2026, 9, 22, 22, 39, 24)
    (d / "Wellue_O2Ring-S_S8AW2100_20260922000000_OXYFRAME.txt").mkdir()  # sorts first
    (d / "Wellue_O2Ring-S_S8AW2100_20260922223924_OXYFRAME.txt").write_text(
        _OXY_HDR + f"{t.isoformat(timespec='milliseconds')};11;25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n"
    )
    assert [v for _t, v in loss_audit.signal_witness(str(d))] == [11]


# ── the audit's own arithmetic, at the precisions and boundaries it publishes ───────────────────────
# The diff-scoped gate surfaced these when #3168 touched `audit_night`: they are the function's whole
# accumulated backlog plus the lines this branch and #3163 added. Each one below is a number or an
# ordering a consumer reads and no assertion observed.


def _two_frag_named_backwards(tmp_path):
    """Two fragments whose NAME order is the reverse of their first-row order, and a third with rows but
    no parseable stamp in them. The sort must use each file's own first row, and must put the file that
    cannot say LAST rather than first."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    rows = 3376  # (3376-1) * 8 ms = 27.000 s exactly
    span1 = (rows - 1) * PERIOD_NS / 1e9
    # the LATER session is named earlier, so a name sort and a stamp sort disagree
    _frag(
        str(d / "Polar_H10_0284_20260920220000_ECG.txt"),
        rows,
        host0=span1 + 60.0,
        dev0=1_000_000_000_000_000_000 + int((span1 + 60.0) * 1e9),
    )
    _frag(str(d / "Polar_H10_0284_20260920225959_ECG.txt"), rows)
    (d / "Polar_H10_0284_20260920230000_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];ecg [uV]\nnot-a-stamp;1;100\n"
    )
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    return str(d)


def test_fragments_are_ordered_by_their_OWN_first_row_not_by_filename(tmp_path):
    """`scans.sort` on each file's first row. A name carries the session start the daemon MEANT to write;
    the rows carry when data actually began. Sorting by name — or collapsing the stamp key so the name
    decides — puts a boundary the wrong way round, and a boundary computed backwards reads as a negative
    host gap that the cut then discards, so the loss between two fragments silently disappears.

    The file whose rows carry no parseable stamp sorts LAST: it cannot state a position, and placing it
    first would make it the anchor every boundary is measured from.
    """
    a = loss_audit.audit_night(_two_frag_named_backwards(tmp_path), DEV, journal=lambda *a: [])
    dev = a["devices"]["Polar H10 0284"]
    assert [f["file"] for f in dev["files"]] == [
        "Polar_H10_0284_20260920225959_ECG.txt",  # earliest FIRST ROW, though its name sorts last
        "Polar_H10_0284_20260920220000_ECG.txt",
        "Polar_H10_0284_20260920230000_ECG.txt",  # no parseable row stamp: last
    ], [f["file"] for f in dev["files"]]
    assert dev["boundary_gaps"] == 1, dev
    # 27.000 s per fragment is 0.45 min, which distinguishes every rounding of it: 0.5 at one decimal,
    # 0.45 at two, 0 as an int, and 0.443 if the divisor were 61 rather than 60.
    assert dev["files"][0]["span_min"] == 0.5, dev["files"]
    assert dev["fragments"] == 3, dev  # three files, one boundary gap, no in-file gaps


def test_TWO_boundary_gaps_are_counted_as_two(tmp_path):
    """`n_boundary += 1`. With one boundary a count of 1 is indistinguishable from an assignment; with two
    it separates `+= 1` from `= 1`, from `-= 1` and from `+= 2`. `fragments` subtracts it, so the same
    fixture pins that sign too — a fragment after a boundary is already counted by its own file."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    rows = 3376
    span = (rows - 1) * PERIOD_NS / 1e9
    for k in range(3):  # three fragments, two boundaries
        off = k * (span + 60.0)
        _frag(
            str(d / f"Polar_H10_0284_2026092022{k:02d}00_ECG.txt"),
            rows,
            host0=off,
            dev0=1_000_000_000_000_000_000 + int(off * 1e9),
        )
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    dev = loss_audit.audit_night(str(d), DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert dev["boundary_gaps"] == 2, dev
    assert dev["fragments"] == 3, dev  # 2 gaps - 2 boundaries + 3 files
    assert len([g for g in dev["gaps"] if g.get("boundary")]) == 2, dev["gaps"]


def test_a_gap_and_a_delay_are_published_AS_WHOLE_SECONDS(tmp_path):
    """Both lists are rounded, and both can only ever hold whole seconds — `nights_index.parse_stamp` is
    SECOND precision by design (its sibling `parse_host_stamp` is the one that keeps sub-second digits
    "for readers that measure with them"). So a 6.01 s host jump between rows 8 ms apart still reports a
    7.0 s gap, and the rounding of these two fields is unobservable by construction rather than untested.
    Pinned here because the next reader will otherwise try, as I did, to plant a fractional one."""
    p = tmp_path / "captures" / "2026-09-20"
    p.mkdir(parents=True)
    f = p / "Polar_H10_0284_20260920220000_ECG.txt"
    _polar(
        f, 15000, host_jumps={6000: 6.01, 9000: 6.01}, dev_steps={6000: int(6.01e9) + PERIOD_NS}
    )  # first a loss, then a pure delay
    (p / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    dev = loss_audit.audit_night(str(p), DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert [g["s"] for g in dev["gaps"]] == [7.0], dev["gaps"]
    assert [x["s"] for x in dev["delays"]] == [6.0], dev["delays"]  # a different sub-second phase
    assert all(float(g["s"]).is_integer() for g in dev["gaps"] + dev["delays"]), (
        "second-precision stamps cannot produce a fractional length",
        dev["gaps"],
        dev["delays"],
    )


def test_an_unreadable_primary_reports_the_ERROR_it_hit_not_just_the_word(tmp_path, monkeypatch):
    """`unreadable[0]["reason"]`, not the bare string. "unreadable" alone tells an operator nothing about
    whether it was a permission, a vanished mount or a torn file, and that is the whole value of the
    field — the night continues either way."""
    d = _night(tmp_path, holes=())
    monkeypatch.setattr(loss_audit, "stream_scan", lambda p: (_ for _ in ()).throw(OSError("eio: the mount went away")))
    dev = loss_audit.audit_night(d, DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert "eio: the mount went away" in dev["reason"], dev["reason"]


def test_a_ring_stall_JUDGED_A_DELAY_does_not_stop_the_next_stall_being_judged(tmp_path):
    """`continue`, never `break`, in the witness loop. Two stalls: the first the ring produced signal
    across, the second it was silent through. Breaking out at the first leaves the second unjudged — it
    keeps no witness key, so it is neither counted as silence nor reported as unwitnessed, and the night
    under-reports the one hole that was real."""
    d = tmp_path / "captures" / "2026-09-22"
    d.mkdir(parents=True)
    start = dt.datetime(2026, 9, 22, 22, 39, 24)
    with open(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_SPO2.csv", "w") as fh:
        fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        for sec in range(400):
            if 100 <= sec < 112 or 200 <= sec < 212:
                continue
            fh.write((start + dt.timedelta(seconds=sec)).strftime("%H:%M:%S %d/%m/%Y") + ",97,58,0\n")
    with open(d / "Wellue_O2Ring-S_S8AW2100_20260922223924_OXYFRAME.txt", "w") as fh:
        fh.write(_OXY_HDR)
        for sec in range(400):
            if 100 <= sec < 112 or 200 <= sec < 212:
                continue
            dur = sec if sec < 200 else 199  # produced through the first stall, silent in the second
            t = (start + dt.timedelta(seconds=sec)).isoformat(timespec="milliseconds")
            fh.write(f"{t};{dur};25.5;0;97;58;1;80;0;0;126;1;0;0;0;2\n")
    dev = loss_audit.audit_night(str(d), RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert [g["witness"] for g in dev["gaps"]] == ["silence"], dev["gaps"]
    assert dev["delayed_min"] == 0.2 and dev["lost_min"] == 0.2, dev
    # advance 0 across the second stall — and 0 is not 1, which is what `round(1)` would publish
    assert dev["gaps"][0]["witness_advance_s"] == 0.0, dev["gaps"]


def test_a_boundary_with_NO_gap_does_not_stop_the_search_for_later_ones(tmp_path):
    """`continue`, never `break`, in the boundary loop. Two files can meet inside the cadence — a
    rollover, a writer reopening its file — and that boundary reports nothing. Breaking there abandons
    every LATER boundary, so a real outage two fragments on vanishes from the night entirely."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    rows = 3376
    span = (rows - 1) * PERIOD_NS / 1e9
    offs = [0.0, span + 0.5, 2 * span + 0.5 + 60.0]  # rollover first, then a real 60 s outage
    for k, off in enumerate(offs):
        _frag(
            str(d / f"Polar_H10_0284_2026092022{k:02d}00_ECG.txt"),
            rows,
            host0=off,
            dev0=1_000_000_000_000_000_000 + int(off * 1e9),
        )
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text("Phone timestamp;HR [bpm]\n" + T0.isoformat() + ";62\n")
    dev = loss_audit.audit_night(str(d), DEV, journal=lambda *a: [])["devices"]["Polar H10 0284"]
    assert dev["boundary_gaps"] == 1, (
        "the rollover reports nothing; the outage after it must not be skipped with it",
        dev,
    )
    assert [g["s"] for g in dev["gaps"] if g.get("boundary")] == [60.0], dev["gaps"]


def test_unwitnessed_minutes_are_published_in_MINUTES(tmp_path):
    """`/ 60.0`. A 27 s unwitnessed gap is 0.5 min at one decimal and 0.4 if the divisor were 61 — the
    only arithmetic in this field, and it is the field a consumer subtracts from a night's loss."""
    d = _ring_stall_night(tmp_path, witness="absent", stall_s=26)
    dev = loss_audit.audit_night(d, RING_DEV, journal=lambda *a: [])["devices"]["Ring"]
    assert [g["s"] for g in dev["gaps"]] == [27.0], dev["gaps"]
    assert dev["unwitnessed_min"] == 0.5, dev["unwitnessed_min"]
    assert dev["lost_min"] == 0.0, dev


# ── the twelve unanswered survivors on `_has_worn_evidence` (#3022, ledger-tracked) ──────────────────
# Reported by the gate on #3022, four days unanswered because an advisory finding used to die with its
# PR. Now in `mutation-survivors.json`; these are the five a test can see. The precedence they exercise
# is the RULED one (CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22 §17: worn = the device's own beat/contact
# evidence in the same night, H10 HR rows > 0) plus this function's own tri-state rule — no new rule is
# derived here, and none of these plants invents a threshold.
_H10_HDR = "Phone timestamp;HR [bpm]"


def test_a_header_without_the_column_does_not_END_the_search(tmp_path, monkeypatch):
    """`continue` → `break`. "A header that does not name the column cannot vouch either way" — the
    NEXT file may, and the night's evidence is routinely in a later file. Order is pinned through
    `glob` for the reason the empty-file sibling above gives: the filesystem promises none, so left
    alone this case only arises when the directory happens to enumerate the useless file first."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    nameless = d / "Polar_H10_0284_20260920000001_HR.txt"
    beats = d / "Polar_H10_0284_20260920220000_HR.txt"
    nameless.write_text("Phone timestamp;something else\nx;72\n")
    beats.write_text(f"{_H10_HDR}\nx;72\n")
    monkeypatch.setattr(loss_audit.glob, "glob", lambda _pat: [str(nameless), str(beats)])
    assert loss_audit._has_worn_evidence(str(d), "H10") is True


def test_an_UNREADABLE_file_does_not_END_the_search_either(tmp_path, monkeypatch):
    """The other `continue` → `break`, and the comment is the contract: "an unreadable evidence file
    cannot vouch for wear; the next file may". A permissions slip on one file must not turn a worn
    night into an unanswered one."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    locked = d / "Polar_H10_0284_20260920000001_HR.txt"
    beats = d / "Polar_H10_0284_20260920220000_HR.txt"
    locked.write_text(f"{_H10_HDR}\nx;72\n")
    beats.write_text(f"{_H10_HDR}\nx;72\n")
    os.chmod(locked, 0)
    monkeypatch.setattr(loss_audit.glob, "glob", lambda _pat: [str(locked), str(beats)])
    try:
        assert loss_audit._has_worn_evidence(str(d), "H10") is True
    finally:
        os.chmod(locked, 0o644)


def test_a_TORN_value_is_not_evidence_even_when_its_digits_look_worn(tmp_path):
    """`line.rstrip("\\n")` → `rstrip("XX\\nXX")`, which also eats a trailing `X`. A torn tail row like
    `72X` then parses as 72 and the night reads WORN on a value no device wrote — the opposite of the
    code's own rule ("a torn row … is not evidence either way"). The column is last here because that
    is where the H10's own `_HR.txt` puts it, which is also the only position where a trailing-character
    strip can reach the value."""
    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text(f"{_H10_HDR}\nx;72X\n")
    got = loss_audit._has_worn_evidence(str(d), "H10")
    assert got is False, (
        f"a torn row was read as a measured beat: {got!r} — the column WAS read, so False is the "
        "verdict ('every measured value this device wrote was absent'), never True"
    )


def test_the_evidence_read_NAMES_its_encoding(tmp_path):
    """`encoding="utf-8"` → `None` / dropped. These files are device CSVs whose bytes are not ours, and
    `errors="replace"` means a wrong codec does NOT raise — it silently substitutes, which is the §∅
    shape (a value manufactured where one was absent) rather than a crash anyone would notice.

    CPython resolves the default encoding in C, so no in-process patch reaches it; `-X
    warn_default_encoding -W error::EncodingWarning` is the supported lever and holds on a UTF-8 box
    and a C-locale one alike. Same two rules as the sibling in test_solid_night_inputs.py:
    IN-PROCESS FIRST (mutmut selects a mutant's tests from coverage and a subprocess is invisible to
    the tracer), and NO `env=` (the child must inherit `MUTANT_UNDER_TEST`, or it runs the original
    function however the parent was mutated)."""
    import subprocess
    import sys

    d = tmp_path / "captures" / "2026-09-20"
    d.mkdir(parents=True)
    (d / "Polar_H10_0284_20260920220000_HR.txt").write_text(f"{_H10_HDR}\nx;72\n")

    assert loss_audit._has_worn_evidence(str(d), "H10") is True

    src = f"import loss_audit\ngot = loss_audit._has_worn_evidence({str(d)!r}, 'H10')\nassert got is True, got\n"
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert r.returncode == 0, r.stderr[-600:]
