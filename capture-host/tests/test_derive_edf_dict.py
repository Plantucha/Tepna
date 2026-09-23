# tepna-capture — tests/test_derive_edf_dict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tools/derive_edf_dict.py` — the dictionary's only author.

⚠️ The fixtures here are written by `cpap_edf.write_edf`, the real writer, not by hand-assembled
bytes. A hand-built EDF could disagree with the format in exactly the way the generator exists to
detect, and the test would pass anyway. Building with the shipped writer means a fixture cannot be
more wrong than the code under test.

The behaviour that matters most is the REFUSAL: two declaration variants must raise rather than pick
a winner, because a majority vote turns a conditional layout into a wrong constant that every later
test agrees with.
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), "tools"))

import cpap_edf  # noqa: E402
import derive_edf_dict as d  # noqa: E402


def _card(tmp_path, files):
    """Build a card tree. `files` is {day: [(name, raw_bytes)]}."""
    root = tmp_path / "card"
    for day, entries in files.items():
        dd = root / "DATALOG" / day
        dd.mkdir(parents=True, exist_ok=True)
        for name, raw in entries:
            (dd / name).write_bytes(raw)
    root.mkdir(parents=True, exist_ok=True)
    return str(root)


def _sa2(seconds=60, serial="S"):
    return cpap_edf.write_edf(cpap_edf.build_sa2(
        [(i, 97, 64) for i in range(seconds)], (2026, 8, 30, 23, 0, 0), serial))


def _brp(records=1):
    n = records * 60 * 25
    return cpap_edf.write_edf(cpap_edf.build_brp(
        [0.1] * n, [8.0] * n, (2026, 8, 30, 23, 0, 0), "S"))


def test_a_single_declaration_set_is_a_contract(tmp_path):
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2()),
                                         ("20260830_230100_SA2.edf", _sa2())]})
    found = d.survey(root)
    assert set(found) == {"SA2"}
    assert found["SA2"]["files"] == 2
    assert found["SA2"]["records"] == 2
    assert found["SA2"]["rec"] == "60.00"
    assert [s[0] for s in found["SA2"]["decl"]] == ["Pulse.1s", "SpO2.1s", "Crc16"]


def test_two_variants_REFUSE_rather_than_vote(tmp_path):
    """The whole point. A majority pick would make a conditional layout into a wrong constant."""
    odd = bytearray(_sa2())
    off = 256 + 16 * 3 + 80 * 3            # first signal's `unit` field
    odd[off:off + 8] = b"bpm2    "
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2()),
                                         ("20260830_230100_SA2.edf", _sa2()),
                                         ("20260830_230200_SA2.edf", bytes(odd))]})
    with pytest.raises(SystemExit) as e:
        d.survey(root)
    assert "declaration sets" in str(e.value)
    assert "conditional" in str(e.value)


def test_an_empty_card_is_refused_not_silently_empty(tmp_path):
    root = str(tmp_path / "nothing")
    os.makedirs(root, exist_ok=True)
    with pytest.raises(SystemExit, match="no EDF files"):
        d.survey(root)


def test_an_unreadable_file_is_counted_not_fatal(tmp_path):
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2()),
                                         ("20260830_230100_SA2.edf", b"too short")]})
    found = d.survey(root)
    assert found["SA2"]["files"] == 1 and found["SA2"]["unreadable"] == 1


@pytest.mark.parametrize("raw", [b"", b"\x00" * 100, b"X" * 256, b"0" * 300])
def test_read_header_returns_None_on_anything_malformed(tmp_path, raw):
    p = tmp_path / "x.edf"
    p.write_bytes(raw)
    fields, rec, decl, n = d.read_header(str(p))
    assert decl is None and n == 0


def test_header_constants_and_variables_are_separated(tmp_path):
    """Fields identical everywhere become the table; fields that differ are NAMED, never guessed."""
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2(serial="AAA")),
                                         ("20260830_230100_SA2.edf", _sa2(serial="BBB"))]})
    found = d.survey(root)
    assert found["SA2"]["header_const"]["reserved"] == "EDF"
    assert "recording" in found["SA2"]["header_varies"]      # the serial differs
    assert "recording" not in found["SA2"]["header_const"]


def test_render_round_trips_into_importable_python(tmp_path):
    # two serials so the rendered module also carries the header_varies branch — a generated file
    # that silently omits "these fields differ" is the one a later reader would trust wrongly.
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2(serial="AAA")),
                                         ("20260830_230100_SA2.edf", _sa2(serial="BBB"))]})
    text = d.render(d.survey(root), root)
    ns = {}
    exec(compile(text, "generated", "exec"), ns)             # noqa: S102 — the point is that it runs
    assert ns["TYPES"]["SA2"]["record_seconds"] == "60.00"
    assert ns["TYPES"]["SA2"]["variants"] == 1
    assert "recording" in ns["TYPES"]["SA2"]["header_varies"]
    assert "reserved" in ns["TYPES"]["SA2"]["header_const"]


def test_report_prints_the_thin_and_varying_notes(tmp_path, capsys):
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2(serial="AAA")),
                                         ("20260830_230100_SA2.edf", _sa2(serial="BBB"))]})
    d.report(d.survey(root))
    out = capsys.readouterr().out
    assert "THIN" in out, "two files and two records is not a contract and must say so"
    assert "header fields that VARY" in out and "recording" in out


def test_main_emit_then_check_is_clean_and_a_stale_file_fails(tmp_path, capsys, monkeypatch):
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2())]})
    out = tmp_path / "gen.py"
    monkeypatch.setattr(sys, "argv", ["x", root, "--emit", str(out)])
    assert d.main() == 0
    monkeypatch.setattr(sys, "argv", ["x", root, "--check", str(out)])
    assert d.main() == 0
    assert "is current" in capsys.readouterr().out
    out.write_text("stale\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["x", root, "--check", str(out)])
    assert d.main() == 1
    assert "STALE" in capsys.readouterr().out


def test_check_against_a_missing_file_is_stale_not_a_crash(tmp_path, monkeypatch):
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2())]})
    monkeypatch.setattr(sys, "argv", ["x", root, "--check", str(tmp_path / "absent.py")])
    assert d.main() == 1


def test_a_root_STR_is_picked_up_from_the_card_root(tmp_path):
    """STR.edf sits at the card root, not under DATALOG — a glob that misses it loses the type."""
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", _sa2())]})
    open(os.path.join(root, "STR.edf"), "wb").write(_brp())   # shape is irrelevant; placement is not
    found = d.survey(root)
    assert "STR" in found and found["STR"]["files"] == 1


def test_a_type_with_inconsistent_record_duration_is_refused(tmp_path):
    a = _sa2()
    b = bytearray(_sa2())
    b[244:252] = b"30.00   "
    root = _card(tmp_path, {"20260830": [("20260830_230000_SA2.edf", a),
                                         ("20260830_230100_SA2.edf", bytes(b))]})
    with pytest.raises(SystemExit, match="record duration is not constant"):
        d.survey(root)



def test_a_truncated_signal_block_is_refused(tmp_path):
    """A file whose header claims more signals than it carries must not yield a partial declaration."""
    raw = bytearray(_sa2())
    p = tmp_path / "cut.edf"
    p.write_bytes(bytes(raw[:256 + 100]))          # main header, then a stub of the signal block
    fields, rec, decl, n = d.read_header(str(p))
    assert decl is None and n == 0
