# tepna-capture — tests/test_rate_intent.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A configured rate the device does not offer must be SAID OUT LOUD.

`polar_pmd.chosen_rate` honours a configured rate only if the device offers it, and otherwise falls
back to its own preference. That is the right behaviour — a rate the firmware rejects leaves a
permanently idle stream — but it makes "I asked for something impossible" indistinguishable from
"I got what I asked for". `rates: {ppg: 176}` without SDK mode captured whole nights at 55 Hz with no
error and a config that still read 176; it took a file-by-file audit across six nights to notice.

These tests drive the REAL `run_polar` against the fake device, so what is asserted is what the daemon
actually negotiated and published — not which function it called.
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import polar_pmd as pmd  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_capture_runners as T  # noqa: E402

# `run_polar` mutates process-wide state and `capture.STATUS` is module-global; without the autouse
# reset each test asserts against its predecessor's leftovers. Adopt the fixture, never re-implement it.
_clean_stop = T._clean_stop


def _drive(tmp_path, monkeypatch, dev):
    T._polar_common(monkeypatch)
    c = T.FakePolarClient()
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    T._run(capture.run_polar(dev, str(tmp_path)))
    return c


def test_an_unofferable_configured_rate_is_WARNED_not_swallowed(tmp_path, monkeypatch, caplog):
    """The fake offers ECG at 130 only. Asking for 176 must not pass in silence."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    warns = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    hit = [w for w in warns if "was NOT offered" in w]
    assert hit, f"no warning about the unmet rate; got {warns}"
    msg = hit[0]
    assert "176" in msg, "the warning must name what was ASKED for"
    assert "130" in msg, "…and what was actually used, plus the device's menu"


def test_the_unmet_rate_is_published_so_a_surface_can_show_it(tmp_path, monkeypatch):
    """A log line is invisible to the monitor. The status carries want/got per stream."""
    _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    unmet = capture.STATUS["devices"]["H10"].get("rate_unmet") or {}
    assert unmet.get("ecg") == {"want": 176, "got": 130}


def test_a_rate_the_device_DOES_offer_is_silent(tmp_path, monkeypatch, caplog):
    """The positive control. A warning that fires on the ordinary case is one people mute."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 130}))
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()]
    assert "rate_unmet" not in capture.STATUS["devices"]["H10"]


def test_no_configured_rate_at_all_is_silent(tmp_path, monkeypatch, caplog):
    """Most devices carry no override; the daemon picks its own preference and that is not a defect."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev())
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()]


def test_the_fallback_itself_is_unchanged(tmp_path, monkeypatch):
    """⚠️ This warns, it does not REFUSE. Falling back is deliberate — a rate the firmware rejects
    leaves an idle stream — so the stream must still start, at the device's rate."""
    c = _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    starts = [w for w in c.writes if len(w) >= 2 and w[0] == 0x02 and w[1] == pmd.ECG]
    assert starts, "the ECG stream must still be started despite the unmet rate"
    ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
    assert ecgs and ecgs[0].stat().st_size > 60, "…and still write data"


def test_a_configured_rate_the_device_DOES_offer_is_actually_USED(tmp_path, monkeypatch, caplog):
    """⚠️ THE OTHER HALF, and the tests above cannot see it. With a single-entry menu, `chosen_rate`
    with the override and `chosen_rate` with `None` return the same number, so dropping `_prefer`
    entirely — never honouring any override — passes every case above. Only a menu with a CHOICE
    separates them.

    SDK mode is what widens the Verity's menu, so this drives it: the fake then offers 130 AND 176,
    the built-in preference is 130, and taking 176 can only happen by honouring the config."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(sdk_mode=True, rates={"ecg": 176}))
    opts = capture.STATUS["devices"]["H10"]["pmd_options"]["ecg"]
    assert opts == [130, 176], f"the menu must offer a real choice, got {opts}"
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()], \
        "176 IS offered here — warning about it would be the false-positive that gets warnings muted"
    assert "rate_unmet" not in capture.STATUS["devices"]["H10"]


# ── …AND INTO THE ARTIFACT (2026-09-22) ─────────────────────────────────────────────────────────
# The tests above prove the daemon SAYS it. Residue 2026-09-22-negotiated-pmd-rate-not-written is the
# same defect one layer out: a log line and a STATUS key are not the recording. Measured on vigil, 3
# days of journal carried 3 `START ppg (negotiated)` lines for the Verity and 0 naming a menu or rate.
# It lands in the SEAMS sidecar, not the stream file: a comment after the stream's header breaks the
# `_rows()` contract (one header line, then only rows) that five writer-contract tests pin.
def _seams_text(tmp_path):
    hits = [os.path.join(r, f) for r, _, fs in os.walk(str(tmp_path)) for f in fs if f.endswith("ECGSEAMS.txt")]
    assert len(hits) == 1, hits
    return open(hits[0]).read()


def _pmd_lines(text):
    return [ln for ln in text.splitlines() if ln.startswith("# pmd ")]


def test_the_negotiated_rate_is_written_beside_the_stream(tmp_path, monkeypatch):
    """The fake offers ECG at 130 only; the config asks 176. The ARTIFACT must carry both."""
    _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    lines = _pmd_lines(_seams_text(tmp_path))
    assert len(lines) == 1, lines
    assert "stream=ecg" in lines[0] and "negotiated=yes" in lines[0]
    assert "rate=130" in lines[0], "what it was ACTUALLY captured at"
    assert "offered=130" in lines[0], "the menu the device reported"
    assert "configured=176" in lines[0], "and what the config asked for, so the gap is in the file"


def test_CONTROL_the_stream_file_still_holds_only_a_header_and_rows(tmp_path, monkeypatch):
    """Why the note is NOT in the stream file. `_rows()` takes lines[1:]; a comment there broke five
    writer-contract tests. This is the control that keeps it out."""
    _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 130}))
    hits = [os.path.join(r, f) for r, _, fs in os.walk(str(tmp_path))
            for f in fs if f.endswith("_ECG.txt") and "SEAMS" not in f]
    lines = [ln for ln in open(hits[0]).read().splitlines() if ln.strip()]
    assert lines[0].startswith("Phone timestamp"), lines[0]
    assert all(len(ln.split(";")) == 4 for ln in lines[1:]), lines[1:4]
    assert not any(ln.startswith("#") for ln in lines[1:]), "no comment may follow the header"


def test_PLANT_an_EMPTY_menu_is_not_a_negotiation_and_says_so(tmp_path):
    """§∅ at the rate. With no menu `build_start` sends no rate TLV, so the device runs at its own
    default and the table value is an ASSUMPTION. `negotiated` is derived from the menu, so a caller
    cannot assert one: passing a rate alongside an empty menu must still write `rate=` EMPTY."""
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ACC.txt"), "acc")
    sc.note_pmd(rate=200, offered=[], configured=52, default=200)   # a rate passed with NO menu
    sc.feed(dt.datetime(2026, 9, 21, 21, 0, 0), 1_000_000_000)      # opens the file
    sc.close()
    line = _pmd_lines(open(str(tmp_path / "X_ACCSEAMS.txt")).read())[0]
    assert "negotiated=no" in line
    assert "rate= " in line + " ", f"the rate field must be EMPTY, not a claim: {line}"
    assert "offered= " in line + " ", f"no menu is an empty field: {line}"
    assert "assumed=200" in line, "the vendor default is named where it reads as an assumption"
    assert "configured=52" in line


def test_the_note_sits_under_the_sidecar_header_not_above_it(tmp_path):
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")
    sc.note_pmd(rate=130, offered=[130], configured=130, default=130)
    sc.feed(dt.datetime(2026, 9, 21, 21, 0, 0), 1_000_000_000)
    sc.close()
    lines = open(str(tmp_path / "X_ECGSEAMS.txt")).read().splitlines()
    assert lines[0].startswith("# stream=ecg rule=clock-seam")
    assert lines[1].startswith("phone_ts;")
    assert lines[2].startswith("# pmd "), lines[:4]


def test_a_RE_negotiation_while_open_is_recorded_too(tmp_path):
    """A rate that changed mid-set is the event this exists to surface."""
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")
    sc.note_pmd(rate=130, offered=[130], configured=130, default=130)
    sc.feed(dt.datetime(2026, 9, 21, 21, 0, 0), 1_000_000_000)      # opens + flushes the first note
    sc.note_pmd(rate=176, offered=[130, 176], configured=176, default=130)   # already open
    sc.close()
    lines = _pmd_lines(open(str(tmp_path / "X_ECGSEAMS.txt")).read())
    assert len(lines) == 2, lines
    assert "rate=130" in lines[0] and "rate=176" in lines[1]


def test_a_stream_that_negotiated_but_delivered_NOTHING_gets_no_file(tmp_path):
    """The note never FORCES a sidecar: `_ensure` opens only for a stream that carries a device clock,
    and a stream with no samples has no clock fact to report."""
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")
    sc.note_pmd(rate=130, offered=[130], configured=130, default=130)
    sc.close()
    assert not os.path.exists(str(tmp_path / "X_ECGSEAMS.txt"))


def test_an_absent_configured_rate_is_an_empty_field_not_a_zero(tmp_path):
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")
    sc.note_pmd(rate=130, offered=[130], configured=None, default=130)
    sc.feed(dt.datetime(2026, 9, 21, 21, 0, 0), 1_000_000_000)
    sc.close()
    line = _pmd_lines(open(str(tmp_path / "X_ECGSEAMS.txt")).read())[0]
    assert "configured= " in line + " ", line
    assert "configured=0" not in line, "absence is empty, never a zero (§∅)"


def test_a_write_failure_on_the_note_does_not_end_the_recording(tmp_path):
    """An annotation must never end a recording — the same rule `feed` and `close` already follow."""
    import writers
    sc = writers._SeamSidecar(str(tmp_path / "X_ECG.txt"), "ecg")
    sc.note_pmd(rate=130, offered=[130], configured=130, default=130)
    sc.feed(dt.datetime(2026, 9, 21, 21, 0, 0), 1_000_000_000)      # opens + flushes the first note

    class _Boom:
        def write(self, *a):
            raise OSError("disk full")

    sc._fh = _Boom()                       # type: ignore[assignment]
    sc.note_pmd(rate=176, offered=[130, 176], configured=176, default=130)   # must not raise
    sc._fh = None
