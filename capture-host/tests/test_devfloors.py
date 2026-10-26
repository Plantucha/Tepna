# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`devfloors.py` — the first comparison in this tree between a DECLARED floor and an INSTALLED version.

The defect it answers (`briefs/RESIDUE.md`, 2026-10-12): `requirements-dev.txt` declared `ruff>=0.16.9`
and `hypothesis>=6.168.3` while the venv `check.sh` prefers ran 0.16.0 and 6.165.10, and every gate was
green — `tests/test_dev_requirements.py` compares NAMES only. These tests pin the two things that make
the new leg worth having: a shortfall is NAMED, and a comparison that could not run never reads as one
that agreed (§∅).
"""

import builtins
import importlib.metadata
import sys

import pytest

import devfloors as D

REAL = "ruff>=0.16.9\nhypothesis>=6.168.3\nmutmut==3.8.0\n"


def _lookup(table):
    return lambda name: table.get(name)


def test_a_floor_above_the_installed_version_is_named_as_a_shortfall():
    """The row's own measurement, reproduced: 0.16.0 against `>=0.16.9` is BELOW, not MET."""
    rows, unreadable = D.survey(REAL, _lookup({"ruff": "0.16.0", "hypothesis": "6.168.3", "mutmut": "3.8.0"}))
    assert unreadable == []
    assert [(r[0], r[4]) for r in rows] == [("ruff", D.BELOW), ("hypothesis", D.MET), ("mutmut", D.MET)]
    assert "ruff 0.16.0 < 0.16.9" in D.note(rows, unreadable, D.BELOW, [])


def test_the_installed_version_may_exceed_the_floor():
    rows, _ = D.survey("ruff>=0.16.9\n", _lookup({"ruff": "0.17.0"}))
    assert rows[0][4] == D.MET


@pytest.mark.parametrize(
    "op,floor,installed,expected",
    [
        (">=", "1.2.3", "1.2.3", D.MET),
        (">=", "1.2", "1.2.0", D.MET),
        (">=", "1.2.0", "1.2", D.MET),
        (">=", "0.16.9", "0.16.10", D.MET),
        (">=", "0.16.9", "0.16.0", D.BELOW),
        ("==", "3.8.0", "3.8.0", D.MET),
        ("==", "3.8.0", "3.9.0", D.OFF_PIN),
        ("==", "3.8.0", "3.7.0", D.OFF_PIN),
    ],
)
def test_the_comparison_is_numeric_per_segment_and_zero_padded(op, floor, installed, expected):
    """`0.16.10` is ABOVE `0.16.9`, which a string compare reverses — the one comparison a floor check
    cannot afford to get backwards. A pin is an identity, so NEWER than `==3.8.0` is a finding too:
    the mutant GENERATOR is the gate and two versions generate different mutant sets."""
    assert D.compare_floor(op, floor, installed) == expected


def test_an_absent_distribution_is_ABSENT_and_never_MET():
    assert D.compare_floor(">=", "1.0", None) == D.ABSENT
    rows, _ = D.survey("detect-secrets>=1.5.0\n", _lookup({}))
    assert rows[0][3] is None and rows[0][4] == D.ABSENT


@pytest.mark.parametrize("floor,installed", [("1.0", "1.0rc1"), ("1.0b1", "1.0"), ("1.0b1", "2.0rc1")])
def test_a_version_this_module_cannot_parse_is_NOT_COMPARABLE(floor, installed):
    """§∅ in the comparison position: a guess at `1.0rc1` would be a measurement nobody made."""
    assert D.version_key(installed) is None or D.version_key(floor) is None
    assert D.compare_floor(">=", floor, installed) == D.NOT_COMPARABLE


def test_version_key_reads_a_numeric_version_and_refuses_the_rest():
    assert D.version_key("0.11.0.1") == (0, 11, 0, 1)
    assert D.version_key("6.165.10") == (6, 165, 10)
    assert D.version_key("1.0.dev0") is None


def test_a_comment_a_blank_line_and_an_inline_comment_are_all_handled():
    text = "# header\n\nruff>=0.16.9   # lint (blocking)\n   # continuation comment\n"
    floors, unreadable = D.declared_floors(text)
    assert floors == [("ruff", ">=", "0.16.9")]
    assert unreadable == []


def test_a_requirement_line_the_pattern_does_not_understand_is_NAMED_not_dropped():
    """A silently skipped line is a floor nobody compares — the exact shape of the defect above, one
    level down. It also drives the run's token to NOT_COMPARABLE through `main`."""
    floors, unreadable = D.declared_floors("ruff>=0.16.9\nfoo<2.0\nbar @ git+https://x\n")
    assert [f[0] for f in floors] == ["ruff"]
    assert unreadable == ["foo<2.0", "bar @ git+https://x"]


def test_the_report_prints_one_row_per_floor_and_names_an_absent_tool():
    rows, unreadable = D.survey("ruff>=0.16.9\nfoo<2.0\n", _lookup({}))
    lines = D.render(rows, unreadable, D.DEV_REQ)
    assert lines[0] == f"  {D.DEV_REQ} — 1 floor(s) declared"
    assert any("ruff" in ln and "(absent)" in ln and D.ABSENT in ln for ln in lines)
    assert any("specifier not understood" in ln and "foo<2.0" in ln for ln in lines)


def test_the_run_s_one_token_is_the_most_actionable_finding():
    assert D.worst([D.MET, D.ABSENT, D.BELOW]) == D.BELOW
    assert D.worst([D.MET, D.ABSENT, D.OFF_PIN]) == D.OFF_PIN
    assert D.worst([D.MET, D.ABSENT, D.NOT_COMPARABLE]) == D.NOT_COMPARABLE
    assert D.worst([D.MET, D.ABSENT]) == D.ABSENT
    assert D.worst([D.MET, D.MET]) == D.MET
    assert D.worst([]) == D.MET


def test_the_note_counts_every_row_and_caps_the_names_it_lists():
    """The note is the line `check.sh` prints in its summary, so it carries the population — a count
    that does not add up is how a leg reports about rows it never examined."""
    table = {f"p{i}": "1.0" for i in range(5)}
    text = "".join(f"p{i}>=2.0\n" for i in range(5))
    rows, unreadable = D.survey(text, _lookup(table))
    line = D.note(rows, unreadable, D.BELOW, [])
    assert "5 floor(s) read, 0 met, 5 below" in line
    assert "+2 more" in line
    met_rows, _ = D.survey("p0>=1.0\n", _lookup(table))
    assert D.note(met_rows, [], D.MET, []).endswith("(MET)")


def test_dist_version_reads_this_interpreter_and_returns_None_for_an_absent_name():
    assert D.dist_version("pytest") == importlib.metadata.version("pytest")
    assert D.dist_version("tepna-no-such-distribution") is None


def test_main_prints_both_tokens_and_returns_the_code_the_state_maps_to(capsys, monkeypatch):
    """The exit code and the token are BOTH read — `check.sh` takes the state from the `=`-anchored
    token and shows the code beside it, so neither may be absent."""
    monkeypatch.setattr(D, "dist_version", lambda name: "0.0.1")
    rc = D.main([])
    out = capsys.readouterr().out
    assert f"{D.TOKEN}-state={D.BELOW}" in out
    assert f"{D.TOKEN}-note=" in out
    assert f"pip install -r {D.RUNTIME_REQ} -r {D.DEV_REQ}" in out
    assert rc == D.RC[D.BELOW] == 1
    # The report itself must reach stdout, naming the interpreter whose versions it just read.
    assert f"  interpreter : {sys.executable}" in out


def test_main_over_met_floors_prints_no_upgrade_line(capsys, monkeypatch):
    monkeypatch.setattr(D, "dist_version", lambda name: "9999.0.0")
    rc = D.main([])
    out = capsys.readouterr().out
    # `mutmut==3.8.0` is the file's one pin, so an all-9999 interpreter is OFF_PIN rather than MET.
    assert f"{D.TOKEN}-state={D.OFF_PIN}" in out
    assert rc == D.RC[D.OFF_PIN]
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([("ruff", ">=", "1.0", "1.0", D.MET)], []))
    rc = D.main([])
    out = capsys.readouterr().out
    assert f"{D.TOKEN}-state={D.MET}" in out
    # With nothing below its floor the note carries the run token instead of a name list, so the
    # state has to reach `note` — dropped, it prints `(None)` and the summary row says nothing.
    assert f"{D.TOKEN}-note=" in out
    assert out.split(f"{D.TOKEN}-note=")[1].splitlines()[0].endswith(f"({D.MET})")
    assert "pip install" not in out
    assert rc == 0


def test_an_argument_is_ignored_out_loud(capsys, monkeypatch):
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([], []))
    D.main(["--json"])
    assert "takes no arguments; ignored: --json" in capsys.readouterr().out


def test_a_declaring_file_that_cannot_be_read_compares_nothing_and_says_so(capsys, monkeypatch):
    """The population IS the file. Absent, the honest report is that no floor was compared — never a
    green leg over zero rows (§🧾: a verdict over `checked: 0` is not a pass)."""
    monkeypatch.setattr(D, "REQS", ("no-such-requirements-file.txt", "no-such-dev-file.txt"))
    rc = D.main([])
    out = capsys.readouterr().out
    assert "could not be read" in out
    assert f"{D.TOKEN}-state={D.NOT_COMPARABLE}" in out
    assert rc == D.RC[D.NOT_COMPARABLE]


def test_an_unreadable_line_drives_the_run_token_even_when_every_floor_is_met(capsys, monkeypatch):
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([("ruff", ">=", "1.0", "1.0", D.MET)], ["foo<2"]))
    D.main([])
    assert f"{D.TOKEN}-state={D.NOT_COMPARABLE}" in capsys.readouterr().out


def test_the_real_file_is_surveyed_without_a_stub():
    """Non-vacuity for everything above: the leg runs against the committed `requirements-dev.txt` and
    the file declares floors. A stubbed-only suite would pass over an empty population."""
    import pathlib

    here = pathlib.Path(D.__file__).parent
    seen = {}
    for req in D.REQS:
        rows, unreadable = D.survey((here / req).read_text(encoding="utf-8"))
        seen[req] = {r[0] for r in rows}
        assert rows, req
        assert all(r[4] in (D.MET, D.BELOW, D.OFF_PIN, D.ABSENT, D.NOT_COMPARABLE) for r in rows)
    # Each file declares its own half, and neither half is empty. A runtime name appearing under the
    # dev file would mean the sections were attributed to the wrong declaring file.
    assert {"ruff", "hypothesis", "mutmut"} <= seen[D.DEV_REQ]
    assert {"bleak", "PyYAML", "aiohttp", "cryptography"} <= seen[D.RUNTIME_REQ]
    assert not seen[D.RUNTIME_REQ] & seen[D.DEV_REQ]


def test_the_first_hash_ends_the_line_not_the_last():
    """Two `#` in one line separate `partition` from `rpartition`. With the last one taken the
    specifier keeps a comment, stops matching, and a declared floor reads as a line nobody understood
    — a shortfall silently demoted to noise."""
    rows, unreadable = D.survey("ruff>=0.16.9  # pinned # see RATIONALE\n", _lookup({"ruff": "0.1.0"}))
    assert unreadable == []
    assert [(r[0], r[2], r[4]) for r in rows] == [("ruff", "0.16.9", D.BELOW)]


def test_a_shorter_version_is_padded_with_zeros_not_with_ones():
    """`1.2` against `>=1.2.1` is BELOW. Padding the short side with anything but zero invents a
    patch release the interpreter does not have, which turns a shortfall into MET."""
    assert D.compare_floor(">=", "1.2.1", "1.2") == D.BELOW
    assert D.compare_floor("==", "1.2.0", "1.2") == D.MET


def test_the_note_lists_three_names_and_counts_the_rest_exactly():
    """The cap is the whole line's contract, so it is read by equality. Off by one in either the slice
    or the threshold prints `+0 more`, or four names under a three-name cap."""

    def line_for(count):
        table = {f"p{i}": "1.0" for i in range(count)}
        text = "".join(f"p{i}>=2.0\n" for i in range(count))
        rows, unreadable = D.survey(text, _lookup(table))
        return D.note(rows, unreadable, D.BELOW, [])

    head3 = (
        "3 floor(s) read, 0 met, 3 below, 0 off its pin, 0 not installed, 0 not comparable, 0 line(s) not understood"
    )
    assert line_for(3) == f"{head3} — p0 1.0 < 2.0, p1 1.0 < 2.0, p2 1.0 < 2.0"
    head4 = (
        "4 floor(s) read, 0 met, 4 below, 0 off its pin, 0 not installed, 0 not comparable, 0 line(s) not understood"
    )
    assert line_for(4) == f"{head4} — p0 1.0 < 2.0, p1 1.0 < 2.0, p2 1.0 < 2.0, +1 more"


def test_a_row_reports_the_version_it_found_and_reserves_absent_for_absence():
    """`(absent)` on a row whose version was read is the §∅ failure in the report: absence and a
    measured value must not print the same."""
    rows, _ = D.survey("ruff>=0.16.9\n", _lookup({"ruff": "0.16.0"}))
    lines = D.render(rows, [], D.DEV_REQ)
    assert lines[1] == f"  {'ruff':<16} declared {'>=0.16.9':<14} found {'0.16.0':<14} {D.BELOW}  [{D.DEV_REQ}]"
    assert "(absent)" not in lines[1]


def test_the_declaring_file_is_found_beside_the_module_not_beside_the_caller(capsys, monkeypatch, tmp_path):
    """`check.sh` runs with the working directory wherever the invoker stood. A path relative to the
    caller finds nothing there and the leg reports NOT_COMPARABLE over an unread file."""
    monkeypatch.chdir(tmp_path)
    rc = D.main([])
    out = capsys.readouterr().out
    assert "could not be read" not in out
    assert "ruff" in out
    assert rc != D.RC[D.NOT_COMPARABLE]


def test_the_declaring_file_is_read_as_utf8_whatever_this_box_prefers(monkeypatch):
    """The locale decides the encoding when the call does not, so an omitted `encoding` passes on this
    box and mangles the file on another. The call is read, not its result."""
    seen = []
    real_open = builtins.open

    def spy(path, *args, **kwargs):
        if any(str(path).endswith(req) for req in D.REQS):
            seen.append(kwargs.get("encoding"))
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy)
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([], []))
    D.main([])
    assert seen == ["utf-8", "utf-8"]


def test_the_unread_file_is_named_in_prose_and_in_the_note(capsys, monkeypatch):
    """`check.sh` shows the note; a human reads the prose line. Neither may degrade to `None` while
    the state token still parses."""
    monkeypatch.setattr(D, "REQS", ("no-such-requirements-file.txt",))
    D.main([])
    out = capsys.readouterr().out
    assert "no-such-requirements-file.txt could not be read: " in out
    assert f"{D.TOKEN}-note=no floor was compared, over 1 declaring file(s), 1 unread" in out


def test_the_runtime_file_is_surveyed_through_main_and_every_row_names_its_file(capsys, monkeypatch):
    """The defect this widening answers (row `2026-10-26-four-runtime-floors-have-no-reader-against-the
    -interpreter`): the leg read the dev file alone, so the four RUNTIME floors had no reader at all.
    `bleak` and `cryptography` are declared by `requirements.txt` and by nothing else, so their rows
    cannot appear unless that file was surveyed."""
    monkeypatch.setattr(D, "dist_version", lambda name: "0.0.1")
    rc = D.main([])
    out = capsys.readouterr().out
    assert f"  {D.RUNTIME_REQ} — 4 floor(s) declared" in out
    for name in ("bleak", "PyYAML", "aiohttp", "cryptography"):
        assert f"{name:<16} declared" in out, name
    runtime_rows = [ln for ln in out.splitlines() if ln.endswith(f"[{D.RUNTIME_REQ}]")]
    dev_rows = [ln for ln in out.splitlines() if ln.endswith(f"[{D.DEV_REQ}]")]
    assert len(runtime_rows) == 4
    assert dev_rows
    # A row attributed to the wrong half sends the reader to the wrong install command.
    assert not any("cryptography" in ln for ln in dev_rows)
    assert not any("mutmut" in ln for ln in runtime_rows)
    # Both halves reach the summary line. A run that overwrote the accumulator per file would render
    # every row above and still count the last file alone here.
    note_line = out.split(f"{D.TOKEN}-note=")[1].splitlines()[0]
    assert note_line.startswith(f"{len(runtime_rows) + len(dev_rows)} floor(s) read, ")
    assert rc == D.RC[D.BELOW]


def test_both_declaring_files_add_into_one_population(capsys, monkeypatch):
    """The per-file render reads `file_rows` directly, so only the token line and the note observe the
    accumulator. One row and one unreadable line per file give a population of two of each, and a run
    that assigned instead of extending would report one of each."""
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([("ruff", ">=", "1.0", "1.0", D.MET)], ["foo<2"]))
    rc = D.main([])
    out = capsys.readouterr().out
    note_line = out.split(f"{D.TOKEN}-note=")[1].splitlines()[0]
    assert note_line.startswith(f"{len(D.REQS)} floor(s) read, {len(D.REQS)} met,")
    assert f"{len(D.REQS)} line(s) not understood" in note_line
    assert rc == D.RC[D.NOT_COMPARABLE]


def test_one_unread_file_still_compares_the_other_and_the_run_says_which(capsys, monkeypatch):
    """§∅ across two populations. The file that WAS read is still compared, and the file that was not
    reaches the token and the note by name — never a token folded from the read half alone."""
    monkeypatch.setattr(D, "REQS", ("no-such-requirements-file.txt", D.DEV_REQ))
    monkeypatch.setattr(D, "survey", lambda text, lookup=None: ([("ruff", ">=", "1.0", "1.0", D.MET)], []))
    rc = D.main([])
    out = capsys.readouterr().out
    assert "no-such-requirements-file.txt could not be read: " in out
    assert f"  {D.DEV_REQ} — 1 floor(s) declared" in out
    note_line = out.split(f"{D.TOKEN}-note=")[1].splitlines()[0]
    assert note_line.startswith("1 floor(s) read, 1 met,")
    assert "1 file(s) unread (no-such-requirements-file.txt)" in note_line
    assert f"{D.TOKEN}-state={D.NOT_COMPARABLE}" in out
    assert rc == D.RC[D.NOT_COMPARABLE]
