# tepna-capture — tests/test_webmon_probe_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`/api/probe-night` — the operator's declaration, GET and POST.

SOLID-NIGHT-COWEAR-AND-PROBE-2026-10-13 §2, on the owner's words: *possibly with manual button to turn
night to probe on/off*. The button on `monitor.html` reaches the night folder through here, and the
SOLID-NIGHT judge reads the marker it writes on the next QC pass.

The endpoint WRITES into the captures tree, so the path it builds is built from an entry of
`os.listdir`, never from the request string — a traversal must not reach a path outside that tree, and
a guard that only inspects the string proves nothing about what `os.path.join` then produces."""

import json
import os

import probe_night as pn
from tests.test_webmon_api import _mk, _serve

AT = "2026-10-13T18:36:15"
ARMED = f"{AT} vigil tepna-capture[854652]: INFO heap probe: ARMED (tracemalloc)"


def _night(tmp_path, night="2026-10-13"):
    d = tmp_path / "captures" / night
    d.mkdir(parents=True)
    (d / f"Polar_H10_02849638_{night.replace('-', '')}220000_ECG.txt").write_text(
        "Phone timestamp;x\n2026-10-13T22:00:00.000;1\n"
    )
    return d


def _get(app, query=""):
    async def go(c):
        r = await c.get("/api/probe-night" + query)
        return r.status, await r.json()

    return _serve(app, go)


def _post(app, body):
    async def go(c):
        r = await c.post("/api/probe-night", json=body)
        return r.status, await r.json()

    return _serve(app, go)


def test_an_undeclared_night_reports_both_nulls_and_no_error(tmp_path):
    """🔴 §∅ ACROSS THE WIRE. `marker_on: null` is *nobody pressed the button for this night* and
    `journal_armed: null` is *no audit has read the journal* — the chip draws each as a sentence, and a
    `false` in either field would tell an operator the box had been checked when nothing had looked."""
    _night(tmp_path)
    status, j = _get(_mk(tmp_path)[0])
    assert status == 200
    assert j == {
        "night": "2026-10-13",
        "on": False,
        "source": None,
        "at": None,
        "reason": None,
        "marker_on": None,
        "journal_armed": None,
        "error": None,
    }


def test_the_endpoint_defaults_to_the_folder_being_written(tmp_path):
    """No `night` named: the operator is marking tonight, and tonight is the folder with the newest
    ACTIVITY — never the newest NAME, because after midnight the writers stay in their session's
    start-date folder while only the sidecars move."""
    old = _night(tmp_path, "2026-10-11")
    new = _night(tmp_path, "2026-10-12")
    os.utime(str(new / os.listdir(str(new))[0]), (1_800_000_000, 1_800_000_000))
    os.utime(str(old / os.listdir(str(old))[0]), (1_700_000_000, 1_700_000_000))
    assert _get(_mk(tmp_path)[0])[1]["night"] == "2026-10-12"


def test_a_named_night_is_read_and_an_unknown_one_is_an_error_not_a_guess(tmp_path):
    _night(tmp_path, "2026-10-11")
    _night(tmp_path, "2026-10-12")
    assert _get(_mk(tmp_path)[0], "?night=2026-10-11")[1]["night"] == "2026-10-11"
    status, j = _get(_mk(tmp_path)[0], "?night=2026-09-01")
    assert status == 200 and j["night"] is None and j["error"] == "no night folder"
    assert j["on"] is False and j["marker_on"] is None


def test_a_traversal_is_refused_rather_than_resolved(tmp_path):
    """The POST writes a file at this path, so the name is checked on the way in — not sanitised."""
    _night(tmp_path)
    for bad in ("?night=../..", "?night=2026-10-13/sub", "?night=..%2Fetc"):
        assert _get(_mk(tmp_path)[0], bad)[1]["error"] == "no night folder", bad
    assert _post(_mk(tmp_path)[0], {"on": True, "night": "../.."}) == (
        404,
        {"ok": False, "error": "no night folder to mark"},
    )


def test_the_post_marks_the_night_and_the_judge_can_read_it(tmp_path):
    """The round trip that is the feature: a press, a marker in the night folder, and a declaration the
    verdict side resolves without asking the API anything."""
    d = _night(tmp_path)
    status, j = _post(_mk(tmp_path)[0], {"on": True})
    assert status == 200 and j["ok"] is True
    assert j["probe_night"]["on"] is True and j["probe_night"]["source"] == "monitor"
    assert j["probe_night"]["marker_on"] is True and j["probe_night"]["night"] == "2026-10-13"
    assert "the judge reads this on the next QC pass" in j["note"]
    marker = json.loads((d / pn.MARKER_NAME).read_text())
    assert marker["on"] is True and marker["by"] == "monitor" and marker["at"]
    assert pn.declaration(str(d))["on"] is True


def test_the_post_withdraws_a_declaration_by_REWRITING_the_marker(tmp_path):
    """⚠️ Off never deletes. The withdrawal is a statement about the night too, and the history is what
    keeps both statements beside the captured bytes."""
    d = _night(tmp_path)
    _post(_mk(tmp_path)[0], {"on": True})
    status, j = _post(_mk(tmp_path)[0], {"on": False})
    assert status == 200 and j["probe_night"]["on"] is False and j["probe_night"]["marker_on"] is False
    assert (d / pn.MARKER_NAME).exists()
    assert json.loads((d / pn.MARKER_NAME).read_text())["history"][-1]["on"] is True
    assert pn.declaration(str(d)) is None


def test_a_journal_armed_night_stays_declared_whatever_the_button_says(tmp_path):
    """🔴 THE CASE THE RESPONSE BLOCK EXISTS FOR. The daemon armed the heap probe, so the night is
    declared; the button can only move the toggle, and the response shows which source decided so the
    button never reads as though it had won."""
    d = _night(tmp_path)
    (d / "LOSS-AUDIT.json").write_text(json.dumps({"devices": {}, "probe_armed": [{"at": AT, "line": ARMED}]}))
    status, j = _post(_mk(tmp_path)[0], {"on": False})
    assert status == 200
    assert j["probe_night"]["on"] is True and j["probe_night"]["source"] == "journal"
    assert j["probe_night"]["marker_on"] is False and j["probe_night"]["journal_armed"] is True
    assert "a journal-armed probe stays declared" in j["note"]


def test_an_audit_read_with_no_probe_is_not_an_unread_journal(tmp_path):
    d = _night(tmp_path)
    (d / "LOSS-AUDIT.json").write_text(json.dumps({"devices": {}, "probe_armed": []}))
    assert _get(_mk(tmp_path)[0])[1]["journal_armed"] is False
    (d / "LOSS-AUDIT.json").write_text("{broken")
    assert _get(_mk(tmp_path)[0])[1]["journal_armed"] is None, "an unreadable audit read nothing"


def test_on_must_be_a_boolean_and_nothing_else(tmp_path):
    """A declaration is a yes or a no. `"true"`, `1` and an absent key are each a malformed request,
    refused rather than coerced — `bool("false")` is `True`."""
    _night(tmp_path)
    for bad in ({}, {"on": "true"}, {"on": 1}, {"on": None}, {"on": "false"}):
        status, j = _post(_mk(tmp_path)[0], bad)
        assert (status, j) == (400, {"ok": False, "error": "on must be true or false"}), bad


def test_a_body_that_is_not_an_object_is_refused_by_the_shared_gate(tmp_path):
    _night(tmp_path)

    async def go(c):
        r = await c.post("/api/probe-night", data="not json")
        return r.status, await r.json()

    status, j = _serve(_mk(tmp_path)[0], go)
    assert status == 400 and j["ok"] is False


def test_a_write_that_fails_is_a_500_that_names_the_error(tmp_path, monkeypatch):
    """A read-only captures tree must not read as a successful declaration."""
    _night(tmp_path)
    monkeypatch.setattr(pn, "write_marker", lambda *a, **k: (_ for _ in ()).throw(OSError("read-only file system")))
    status, j = _post(_mk(tmp_path)[0], {"on": True})
    assert status == 500 and j["ok"] is False
    assert "OSError" in j["error"] and "read-only file system" in j["error"]


def test_an_unlistable_captures_tree_is_no_night_rather_than_a_crash(tmp_path):
    """`newest_night` answers `""` when the tree cannot be listed — the box before its first capture."""
    status, j = _get(_mk(tmp_path)[0])
    assert status == 200 and j["night"] is None and j["error"] == "no night folder"


def test_A_NEIGHBOUR_OF_THE_NIGHTS_IS_NOT_MARKABLE_BY_ITS_OWN_NAME(tmp_path):
    """`cpap`, `stored` and `sniffer` sit in the captures tree beside the night folders, and the newest
    of them by mtime can be any of those. A write may land only in a folder whose name IS a night."""
    _night(tmp_path)
    (tmp_path / "captures" / "stored").mkdir()
    status, j = _get(_mk(tmp_path)[0], "?night=stored")
    assert status == 200 and j["night"] is None and j["error"] == "no night folder"
    assert _post(_mk(tmp_path)[0], {"on": True, "night": "stored"})[1] == {
        "ok": False,
        "error": "no night folder to mark",
    }
    assert not (tmp_path / "captures" / "stored" / pn.MARKER_NAME).exists()


def test_A_CAPTURES_TREE_WITH_NO_NIGHT_FOLDER_IN_IT_IS_NO_NIGHT(tmp_path):
    """Two shapes that are not a night, and one answer for both: the tree lists, and nothing in it is a
    night folder. The second shape is a FILE whose name reads like a night — the name check passes it
    and the folder check refuses it, which is why both checks stay."""
    cap = tmp_path / "captures"
    cap.mkdir()
    (cap / "status.json").write_text("{}")
    status, j = _get(_mk(tmp_path)[0])
    assert status == 200 and j["night"] is None and j["error"] == "no night folder"

    (cap / "2026-10-13").write_text("not a folder")
    status, j = _get(_mk(tmp_path)[0], "?night=2026-10-13")
    assert status == 200 and j["night"] is None and j["error"] == "no night folder"
