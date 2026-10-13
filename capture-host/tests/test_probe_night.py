# tepna-capture — tests/test_probe_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`probe_night` — a night the box spent PROBING is DECLARED, never inferred.

SOLID-NIGHT-COWEAR-AND-PROBE-2026-10-13-BRIEF §2. Two declarations, either one enough: the daemon's
`heap probe: ARMED` journal line (the probe injects event-loop stalls of 1-12 s on purpose, measured
2026-09-25 at `capture.py:12033`) and the operator's `PROBE-NIGHT.json` toggle.

🔴 THE PROPERTY UNDER TEST THROUGHOUT IS THAT NOTHING HERE LOOKS AT THE DATA. A night with
probe-shaped gaps and no declaration must come out exactly as it does today, because inferring a cause
from a shape is the defect the owner ruled out on 2026-10-12 (the flat-battery charger inference).

The second property is the pair of nulls, each of which a `false` would silently falsify:
  · `marker_on is None` — nobody pressed the button for this night;
  · `journal_armed is None` — nothing read the journal, so no claim either way is licensed (§∅).
"""

import datetime as dt
import json
import os
import subprocess

import loss_audit as _la
import probe_night as pn

AT = "2026-10-13T18:36:15"
ARMED = f"{AT} vigil tepna-capture[854652]: INFO heap probe: ARMED (tracemalloc, 25 frames)"


def _marker(d, obj):
    (d / pn.MARKER_NAME).write_text(json.dumps(obj))


# ── the marker ──────────────────────────────────────────────────────────────────────────────────────


def test_an_absent_broken_or_non_object_marker_all_read_as_nobody_said_anything(tmp_path):
    """Three different failures, one meaning: the operator has made no statement about this night. That
    is NOT `on: false`, which is a statement that was made and withdrawn."""
    assert pn.read_marker(str(tmp_path)) is None
    (tmp_path / pn.MARKER_NAME).write_text("{not json")
    assert pn.read_marker(str(tmp_path)) is None
    (tmp_path / pn.MARKER_NAME).write_text("[1, 2]")
    assert pn.read_marker(str(tmp_path)) is None
    assert pn.read_marker(str(tmp_path / "no-such-night")) is None


def test_writing_the_marker_states_the_night_and_who_said_so(tmp_path):
    got = pn.write_marker(str(tmp_path), on=True, at=AT)
    assert got == {"on": True, "at": AT, "by": "monitor", "history": []}
    assert pn.read_marker(str(tmp_path)) == got
    assert not os.path.exists(str(tmp_path / (pn.MARKER_NAME + ".tmp"))), "the temporary file is replaced, not left"


def test_turning_it_OFF_REWRITES_the_marker_and_never_deletes_it(tmp_path):
    """⚠️ §∅ applied to a statement rather than a sample. A withdrawal is itself an operator statement
    about the night; a deleted marker would leave the night reading as though nobody had ever spoken,
    and the dated history beside the captured bytes is how a correction is recorded here."""
    pn.write_marker(str(tmp_path), on=True, at=AT)
    off = pn.write_marker(str(tmp_path), on=False, at="2026-10-13T19:00:00")
    assert os.path.exists(str(tmp_path / pn.MARKER_NAME))
    assert off["on"] is False
    assert off["history"] == [{"on": True, "at": AT, "by": "monitor"}]


def test_the_history_keeps_every_statement_up_to_its_bound(tmp_path):
    """An evening of on/off presses is a handful, and the bound exists only so a night cannot grow an
    unbounded file. The OLDEST goes, so the most recent statements are the ones kept."""
    for i in range(pn.HISTORY_KEEP + 5):
        pn.write_marker(str(tmp_path), on=bool(i % 2), at=f"2026-10-13T19:{i:02d}:00")
    got = pn.read_marker(str(tmp_path))
    assert len(got["history"]) == pn.HISTORY_KEEP
    assert got["history"][-1]["at"] == f"2026-10-13T19:{pn.HISTORY_KEEP + 3:02d}:00"


def test_a_marker_whose_history_is_rubbish_is_not_carried_forward(tmp_path):
    """A hand-edited marker must not be able to put a non-object into the next write's history."""
    _marker(tmp_path, {"on": True, "at": AT, "by": "monitor", "history": ["x", None, {"on": False}]})
    got = pn.write_marker(str(tmp_path), on=False, at="2026-10-13T20:00:00")
    assert got["history"] == [{"on": False}, {"on": True, "at": AT, "by": "monitor"}]


def test_the_stamp_a_declaration_carries_is_local_civil_time_to_the_second(tmp_path):
    """Clock Contract §1: a floating wall-clock stamp, the clock every night folder on this box is
    written in — never an instant with a zone bolted on, which `fromisoformat` would then re-read as a
    different local time."""
    got = pn.now_iso()
    assert dt.datetime.fromisoformat(got)
    assert got.endswith(("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"))
    assert "+" not in got and "Z" not in got and len(got) == 19


# ── the journal half ────────────────────────────────────────────────────────────────────────────────


def test_armed_records_tells_UNREAD_apart_from_READ_AND_NOTHING_ARMED():
    """🔴 THE DISTINCTION THAT DECIDES A NIGHT. `[]` is *the journal was read and no probe armed*,
    which lets the ordinary judge run. `None` is *nothing read the journal* — including every audit
    written before this record existed, which did not look."""
    assert pn.armed_records(None) is None
    assert pn.armed_records({}) is None, "an audit with no such key did not look"
    assert pn.armed_records({"probe_armed": None}) is None, "journalctl was unavailable"
    assert pn.armed_records({"probe_armed": "x"}) is None
    assert pn.armed_records("not an audit") is None
    assert pn.armed_records({"probe_armed": []}) == [], "read, and no probe armed"
    assert pn.armed_records({"probe_armed": [{"at": AT}, "junk"]}) == [{"at": AT}]


# ── the declaration, and which half spoke ───────────────────────────────────────────────────────────


def test_an_undeclared_night_is_None_whatever_its_data_looks_like(tmp_path):
    """The CONTROL for this whole module. No journal record, no marker, and a marker that was withdrawn
    — each leaves the ordinary judge in force."""
    assert pn.declaration(str(tmp_path)) is None
    assert pn.declaration(str(tmp_path), {"probe_armed": []}) is None
    _marker(tmp_path, {"on": False, "at": AT, "by": "monitor"})
    assert pn.declaration(str(tmp_path), {"probe_armed": []}) is None
    _marker(tmp_path, {"at": AT})  # a marker that does not say `on` has declared nothing
    assert pn.declaration(str(tmp_path)) is None
    _marker(tmp_path, {"on": "yes"})  # `is True`, not a truthy read
    assert pn.declaration(str(tmp_path)) is None


def test_the_journal_declares_the_night_and_the_toggle_cannot_withdraw_it(tmp_path):
    """A toggle turned off cannot un-arm a probe that already traced: the journal line is a fact about
    the run, the marker a statement about the night. So the journal is read first, and the verdict
    names it as the source."""
    _marker(tmp_path, {"on": False, "at": "2026-10-13T20:00:00", "by": "monitor"})
    got = pn.declaration(str(tmp_path), {"probe_armed": [{"at": AT, "line": ARMED}]})
    assert got == {
        "on": True,
        "source": "journal",
        "at": AT,
        "reason": f"probe night: declared by journal heap-probe ARMED at {AT}",
    }


def test_the_toggle_declares_a_night_the_journal_says_nothing_about(tmp_path):
    _marker(tmp_path, {"on": True, "at": AT, "by": "monitor"})
    got = pn.declaration(str(tmp_path), {"probe_armed": []})
    assert got["on"] is True and got["source"] == "monitor"
    assert got["reason"] == f"probe night: declared by monitor toggle at {AT}"


def test_a_declaration_with_no_time_is_still_a_declaration(tmp_path):
    """The night is a probe night whether or not the stamp survived. §∅ in the other direction: a
    missing time must not be filled in, and must not discard the statement either."""
    for audit, marker in (({"probe_armed": [{"line": ARMED}]}, None), (None, {"on": True, "by": "monitor"})):
        if marker is not None:
            _marker(tmp_path, marker)
        got = pn.declaration(str(tmp_path), audit)
        assert got["on"] is True and got["at"] is None and got["reason"] == pn.UNNAMED


# ── the block the monitor paints ────────────────────────────────────────────────────────────────────


def test_state_names_the_night_and_both_nulls(tmp_path):
    night = tmp_path / "2026-10-13"
    night.mkdir()
    got = pn.state(str(night))
    assert got == {
        "night": "2026-10-13",
        "on": False,
        "source": None,
        "at": None,
        "reason": None,
        "marker_on": None,
        "journal_armed": None,
    }
    assert pn.state(str(night) + "/")["night"] == "2026-10-13", "a trailing slash is not a night name"


def test_state_separates_the_button_from_the_declaration(tmp_path):
    """The monitor's chip needs all four: whether the night is declared, by what, what the toggle says,
    and whether anything read the journal. A button that showed only itself would read as *off* on a
    journal-armed night and an operator would believe the night was being judged."""
    _marker(tmp_path, {"on": False, "at": "2026-10-13T20:00:00", "by": "monitor"})
    got = pn.state(str(tmp_path), {"probe_armed": [{"at": AT, "line": ARMED}]})
    assert got["on"] is True and got["source"] == "journal" and got["at"] == AT
    assert got["marker_on"] is False and got["journal_armed"] is True

    got = pn.state(str(tmp_path), {"probe_armed": []})
    assert got["on"] is False and got["source"] is None and got["journal_armed"] is False
    assert got["at"] == "2026-10-13T20:00:00", "a withdrawn statement still has a time"

    _marker(tmp_path, {"on": True, "by": "monitor"})
    assert pn.state(str(tmp_path), {"probe_armed": []})["at"] is None


def test_state_of_a_night_with_no_folder_name_at_all(tmp_path):
    """`os.path.basename` of a root is empty, and an empty string is not a night (§∅)."""
    assert pn.state("/")["night"] is None


# ── the journal reader that writes the record (loss_audit) ──────────────────────────────────────────

SINCE = dt.datetime(2026, 10, 13, 18, 0, 0)
UNTIL = dt.datetime(2026, 10, 14, 10, 0, 0)


def _run(out="", rc=0, exc=None):
    def run(cmd, **kw):
        if exc is not None:
            raise exc
        assert cmd[:3] == ["journalctl", "-u", "tepna-capture"], cmd
        return subprocess.CompletedProcess(cmd, rc, out, "")

    return run


def test_read_probe_armed_returns_the_lines_in_order_with_their_stamps():
    later = "2026-10-13T22:10:00 vigil tepna-capture[1]: INFO heap probe: ARMED again"
    out = "\n".join([later, "2026-10-13T18:00:00 vigil tepna-capture[1]: INFO capture is live", ARMED])
    got = _la.read_probe_armed(SINCE, UNTIL, run=_run(out))
    assert [t.isoformat() for t, _ in got] == ["2026-10-13T18:36:15", "2026-10-13T22:10:00"]
    assert got[0][1] == ARMED


def test_read_probe_armed_returns_an_EMPTY_list_when_the_journal_held_no_probe():
    """Read, and nothing armed — the answer that lets the night be judged. It must not be `None`."""
    assert _la.read_probe_armed(SINCE, UNTIL, run=_run("2026-10-13T18:00:00 x: INFO capture is live")) == []


def test_read_probe_armed_is_None_when_the_journal_cannot_be_read():
    """§∅: journalctl absent, failing, or timing out licenses no claim about the night."""
    assert _la.read_probe_armed(SINCE, UNTIL, run=_run(rc=1)) is None
    assert _la.read_probe_armed(SINCE, UNTIL, run=_run(exc=OSError("no journalctl"))) is None
    assert _la.read_probe_armed(SINCE, UNTIL, run=_run(exc=subprocess.TimeoutExpired("journalctl", 120))) is None


def test_read_probe_armed_skips_a_matching_line_with_no_readable_stamp():
    """A line without a `short-iso` stamp cannot be placed in time, so it is not a record. The needle
    is still what selects the line — a stamp-less match must not be counted as a declaration."""
    assert _la.read_probe_armed(SINCE, UNTIL, run=_run("-- Boot --\nheap probe: ARMED")) == []


def test_the_audit_writes_the_record_beside_the_night_and_names_its_source(tmp_path):
    """The verdict side keeps no journal and journald rotates, so the night must stay answerable from
    its own files — the same reason `clock_events` is written there."""
    out = _la.audit_night(
        str(tmp_path),
        [],
        journal=lambda *a, **k: [],
        clock_events=lambda *a, **k: [],
        journal_shape_of=lambda *a, **k: None,
        probe_armed=lambda since, until: [(dt.datetime.fromisoformat(AT), ARMED)],
    )
    assert out["probe_armed"] == [{"at": AT, "line": ARMED}]
    assert out["probe_armed_source"] == "journalctl -u tepna-capture"
    assert pn.armed_records(out) == [{"at": AT, "line": ARMED}]


def test_an_unreadable_journal_leaves_the_audits_record_null_and_says_unavailable(tmp_path):
    out = _la.audit_night(
        str(tmp_path),
        [],
        journal=lambda *a, **k: [],
        clock_events=lambda *a, **k: [],
        journal_shape_of=lambda *a, **k: None,
        probe_armed=lambda since, until: None,
    )
    assert out["probe_armed"] is None and out["probe_armed_source"] == "unavailable"
    assert pn.armed_records(out) is None, "and the judge must not read that as no probe armed"


def test_write_night_forwards_the_reader_so_the_record_reaches_the_file(tmp_path):
    """The injection point the suite needs, and the wiring a missing keyword would silently drop: the
    default would then read the real journal of the machine running the tests."""
    seen = {}

    def probe_armed(since, until):
        seen["window"] = (since, until)
        return []

    _la.write_night(
        str(tmp_path),
        [],
        journal=lambda *a, **k: [],
        clock_events=lambda *a, **k: [],
        journal_shape_of=lambda *a, **k: None,
        probe_armed=probe_armed,
    )
    with open(os.path.join(str(tmp_path), _la.AUDIT_NAME), encoding="utf-8") as fh:
        assert json.load(fh)["probe_armed"] == []
    assert "window" in seen, "the audit asked for the window rather than being handed one"
