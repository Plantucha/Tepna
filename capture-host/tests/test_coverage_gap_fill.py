"""Coverage gap-fill — the last uncovered branches in five otherwise-complete modules.

Every case here is a real failure mode the module already guards against but nothing exercised: an
absent BlueZ, an unmounted backup volume, a filename shape that must be REFUSED, and the CLI's
nothing-found exit. Grouped in one file because each is a one-branch fill, not a module's worth of work.
"""
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import adapter_ab  # noqa: E402
import link_rssi  # noqa: E402
import nightarchive  # noqa: E402
import ppg_grid_check as pgc  # noqa: E402
import writers  # noqa: E402


# ── adapter_ab._pct ─────────────────────────────────────────────────────────────────────────────────
def test_pct_of_nothing_is_none_not_an_exception():
    """An A/B leg that recorded no samples must report "no data", not raise — the comparison summary is
    built from whatever legs ran, and one empty leg cannot take the report down with it."""
    assert adapter_ab._pct([], 50) is None
    assert adapter_ab._pct([-80.0], 50) == -80.0


# ── link_rssi.dbus_hci ──────────────────────────────────────────────────────────────────────────────
def test_dbus_hci_returns_empty_when_bluetooth_sysfs_is_absent(monkeypatch):
    """No /sys/class/bluetooth at all — BlueZ not up, or a container without the class. The caller keeps
    whatever hcitool/sysfs already gave it, so this must degrade to {} rather than raising into the
    rssi_poller, whose failure would silently cost the night's link provenance."""
    def boom(_p):
        raise OSError("no such directory")
    monkeypatch.setattr(link_rssi.os, "listdir", boom)
    assert link_rssi.asyncio.get_event_loop_policy() is not None      # sanity: module imports clean
    import asyncio
    assert asyncio.run(link_rssi.dbus_hci()) == {}


# ── nightarchive.unarchived_nights ──────────────────────────────────────────────────────────────────
def test_unarchived_nights_keeps_everything_when_the_dest_probe_raises(tmp_path, monkeypatch):
    """`os.path.isdir` on a dead NFS/USB mount can raise rather than return False. The guard must fail
    SAFE — confirm nothing archived, so retention keeps every night. Licensing deletion on an unreadable
    backup volume is the one outcome this function exists to prevent."""
    cap = tmp_path / "captures"
    (cap / "2026-07-25").mkdir(parents=True)
    monkeypatch.setattr(nightarchive.diskguard, "list_nights", lambda _d: ["2026-07-25"])

    def boom(_p):
        raise OSError("stale file handle")
    monkeypatch.setattr(nightarchive.os.path, "isdir", boom)
    assert nightarchive.unarchived_nights(str(cap), dest="/mnt/backup") == {"2026-07-25"}


# ── writers.file_device_id ──────────────────────────────────────────────────────────────────────────
def test_file_device_id_reads_polar_sensor_loggers_split_stamp():
    """PSL writes `<id>_YYYYMMDD_HHMMSS_<tag>` — the stamp is split across two tokens, so the parser has
    to step back over HHMMSS onto YYYYMMDD to find the id. The previous parser could not read this."""
    assert writers.file_device_id("Polar_H10_02849638_20260725_225058_ECG.txt") == "02849638"


@pytest.mark.parametrize("fname", [
    "Polar_H10_02849638_notadate_ECG.txt",       # stamp token is neither DATE14 nor DATE8
    "Tepna_20260725_LINK.csv",                   # sidecar: no device-id field at all
])
def test_file_device_id_refuses_what_it_cannot_prove(fname):
    """Returning a wrong id is worse than returning none: `IDENTITY_FIELDS` attribution is an exact
    field comparison, so a bad id silently orphans every file it touches."""
    assert writers.file_device_id(fname) is None


# ── writers.StreamWriter — the RR sibling path ──────────────────────────────────────────────────────
def test_hr_writer_derives_an_rr_path_even_without_an_hr_token(tmp_path):
    """`rr` never opens its own writer — it rides `hr`. The normal path swaps the last `_HR.` token, but
    a path lacking it must still get a distinct RR file rather than colliding with the HR one."""
    p = tmp_path / "heart.txt"
    w = writers.StreamWriter(str(p), "hr")
    try:
        assert w._rr_fh is not None
        assert os.path.exists(str(tmp_path / "heart_RR.txt"))
        assert os.path.exists(str(p))
    finally:
        w.close()


# ── writers.LinkLogWriter — the provenance comment ──────────────────────────────────────────────────
def test_link_log_records_both_the_pinned_adapter_and_the_resolved_hci(tmp_path):
    """Both are kept because hci indices re-enumerate — a controller power-cycle swapped hci0/hci2 on
    2026-07-18, so neither alone identifies the radio after the fact."""
    p = tmp_path / "Tepna_20260725_LINK.csv"
    w = writers.LinkLogWriter(str(p), adapter="AC:A7:F1:29:9D:1D", hci="hci0")
    w.close()
    head = p.read_text().splitlines()[0]
    assert head.startswith("# adapter=AC:A7:F1:29:9D:1D") and "hci=hci0" in head


def test_link_log_names_the_default_adapter_when_unpinned(tmp_path):
    p = tmp_path / "L.csv"
    w = writers.LinkLogWriter(str(p), adapter=None, hci="hci1")
    w.close()
    assert "adapter=default" in p.read_text().splitlines()[0]


# ── ppg_grid_check ──────────────────────────────────────────────────────────────────────────────────
def _ppg(tmp_path, body: str):
    p = tmp_path / "o2ppg.csv"
    # THREE fields minimum: grid_inflation rejects anything shorter before it ever parses, so a
    # two-column fixture silently tests the length guard instead of the branch you meant.
    p.write_text("Phone timestamp;ns;val\n" + body)
    return str(p)


def test_first_and_last_row_skips_blank_lines(tmp_path):
    """A trailing newline or a torn write leaves blank lines; they are not rows and must not become the
    'last' sample the inflation ratio is computed from."""
    p = _ppg(tmp_path, "2026-07-25T22:00:00.000;0;1\n\n2026-07-25T22:00:10.000;10000000000;2\n\n")
    first, last, rows = pgc._first_and_last_row(p)
    assert rows == 2 and last.startswith("2026-07-25T22:00:10")


def test_grid_inflation_returns_none_on_an_unparseable_row(tmp_path):
    p = _ppg(tmp_path, "notatimestamp;0;1\nalso-bad;10;2\n")
    assert pgc.grid_inflation(p) is None


def test_grid_inflation_returns_none_when_wall_time_does_not_advance(tmp_path):
    """Identical stamps give wall == 0; dividing the grid by it would be a ZeroDivisionError, and a
    'ratio' from a zero-length window would be meaningless anyway."""
    p = _ppg(tmp_path, "2026-07-25T22:00:00.000;0;1\n2026-07-25T22:00:00.000;1000000000;2\n")
    assert pgc.grid_inflation(p) is None


def test_main_reports_when_no_ppg_files_exist(tmp_path, capsys):
    """Exit 0, not an error: "there are no O2Ring PPG files here" is a normal answer for a night the
    ring never streamed, and a non-zero exit would fail an operator's routine check."""
    assert pgc.main([str(tmp_path)]) == 0
    assert "no O2Ring PPG files found" in capsys.readouterr().out
