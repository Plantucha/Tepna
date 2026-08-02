# tepna-capture — tests/test_probe_polar_onboard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The Phase-0 recon probe (POLAR-ONBOARD-BACKUP). It is a hand-run tool, but every answer it produces
# feeds a design decision, so its decision logic is worth pinning — particularly the three places it is
# required to say UNKNOWN rather than pick a plausible value, which is the failure this whole probe
# exists to avoid making on the user's behalf.

import asyncio
import datetime as _dt

import probe_polar_onboard as probe


def _run(coro):
    return asyncio.run(coro)


# ── the version gate ─────────────────────────────────────────────────────────────────────────────────

def test_parse_fw_reads_a_dotted_version():
    assert probe.parse_fw("3.0.16") == (3, 0, 16)
    assert probe.parse_fw("  2.1.0 ") == (2, 1, 0)


def test_parse_fw_returns_none_for_anything_that_is_not_one():
    for bad in (None, "", "   ", "v3.0.16", "3.0.16-beta", "unknown", "3..0"):
        assert probe.parse_fw(bad) is None, f"{bad!r} parsed as a version"


def test_offline_support_is_tri_state_and_unknown_is_not_false():
    """THE honesty rule. 'The firmware could not be read' and 'the firmware is too old' are different
    facts and only one of them abandons the design."""
    assert probe.offline_supported((3, 0, 16)) is True
    assert probe.offline_supported((2, 1, 0)) is True, "the floor itself qualifies"
    assert probe.offline_supported((2, 0, 9)) is False
    assert probe.offline_supported(None) is None, "unknown must NOT collapse to False"


# ── the capacity picture ─────────────────────────────────────────────────────────────────────────────

_FS = [
    ("/U/0/20260716/E/170114/SAMPLES.BPB", 12000, False),
    ("/U/0/20260716/E/170114/TSESS.BPB", 300, False),
    ("/U/0/20260729/R/031500/SAMPLES.BPB", 8000, False),
    ("/SYS/BT/0/BOND.BPB", 90, False),
    ("/SYSLOG.BPB", 1500, False),
    ("/U/0/20260716/E/170114/", 0, True),          # directories must not be counted twice
]


def test_summarize_counts_recording_sessions_not_files():
    got = probe.summarize_fs(_FS)
    assert got["n_sessions"] == 2
    assert got["sessions"] == ["/U/0/20260716/E/170114", "/U/0/20260729/R/031500"]


def test_summarize_separates_recording_bytes_from_system_bytes():
    """A total that quietly excludes things is how a capacity figure becomes a wrong number, so both
    are reported and the total is their sum."""
    got = probe.summarize_fs(_FS)
    assert got["recording_bytes"] == 20300
    assert got["system_bytes"] == 1590
    assert got["total_bytes"] == 21890


def test_summarize_is_empty_on_clear_flash():
    got = probe.summarize_fs([])
    assert got == {"sessions": [], "n_sessions": 0, "recording_bytes": 0,
                   "system_bytes": 0, "total_bytes": 0}


def test_a_user_file_outside_a_session_directory_counts_its_bytes_but_is_not_a_session():
    """`/U/0/USERID.BPB` is user-area data, not a recording. Its bytes are real (they occupy the same
    flash the limit is measured against) but calling it a session would over-count the thing that
    blocks the H10's single slot."""
    got = probe.summarize_fs([("/U/0/USERID.BPB", 40, False)])
    assert got["recording_bytes"] == 40
    assert got["n_sessions"] == 0 and got["sessions"] == []


def test_a_negative_or_missing_size_never_subtracts_from_the_total():
    got = probe.summarize_fs([("/U/0/20260716/E/170114/A.BPB", None, False),
                              ("/U/0/20260716/E/170114/B.BPB", -5, False)])
    assert got["recording_bytes"] == 0


# ── the clock offset ─────────────────────────────────────────────────────────────────────────────────

def test_clock_offset_is_signed_seconds():
    d = _dt.datetime(2026, 8, 1, 23, 0, 5)
    h = _dt.datetime(2026, 8, 1, 23, 0, 0)
    assert probe.clock_offset_sec(d, h) == 5.0
    assert probe.clock_offset_sec(h, d) == -5.0


def test_an_unreadable_device_clock_is_none_never_zero():
    """0.0 reads as 'perfectly in sync'. The truth is 'not measured', and the correction scheme the
    brief describes depends on telling those apart."""
    h = _dt.datetime(2026, 8, 1, 23, 0, 0)
    assert probe.clock_offset_sec(None, h) is None
    assert probe.clock_offset_sec(h, None) is None


# ── the verdict ──────────────────────────────────────────────────────────────────────────────────────

def test_a_clear_supported_device_has_no_blockers():
    v = probe.verdict(True, probe.summarize_fs([]))
    assert v["offline_recording_supported"] is True
    assert v["flash_is_clear"] is True
    assert v["blockers"] == []


def test_an_existing_session_is_a_blocker_because_the_h10_holds_only_one():
    v = probe.verdict(True, probe.summarize_fs(_FS))
    assert v["flash_is_clear"] is False
    assert len(v["blockers"]) == 1 and "already on flash" in v["blockers"][0]


def test_old_firmware_and_a_stale_session_are_reported_as_two_separate_blockers():
    v = probe.verdict(False, probe.summarize_fs(_FS))
    assert len(v["blockers"]) == 2
    assert any("2.1.0" in b for b in v["blockers"])


def test_unknown_firmware_is_its_own_blocker_and_says_UNKNOWN_not_absent():
    v = probe.verdict(None, probe.summarize_fs([]))
    assert v["offline_recording_supported"] is None
    assert len(v["blockers"]) == 1 and "UNKNOWN, not absent" in v["blockers"][0]


# ── the flow, over injected fakes (no radio) ─────────────────────────────────────────────────────────

class _FakeFs:
    def __init__(self, when=_dt.datetime(2026, 8, 1, 23, 0, 3), entries=()):
        self._when, self._entries = when, entries

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get_local_time(self):
        return self._when

    async def walk(self, _path="/"):
        for e in self._entries:
            yield e


class _FakeClient:
    def __init__(self, fw=b"3.0.16", raises=False):
        self._fw, self._raises = fw, raises

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def read_gatt_char(self, _uuid):
        if self._raises:
            raise RuntimeError("characteristic not found")
        return self._fw


def test_the_probe_assembles_a_full_picture(monkeypatch):
    out = _run(probe.probe("24:AC:AC:0C:30:1E", "hci0",
                           _fs=lambda: _FakeFs(entries=_FS), _client=lambda: _FakeClient()))
    assert out["address"] == "24:AC:AC:0C:30:1E" and out["hci"] == "hci0"
    assert out["firmware"] == "3.0.16" and out["firmware_parsed"] == [3, 0, 16]
    assert out["offline_supported"] is True
    assert out["filesystem"]["n_sessions"] == 2
    assert out["clock_offset_sec"] is not None
    assert out["verdict"]["flash_is_clear"] is False


def test_an_unreadable_firmware_characteristic_degrades_to_UNKNOWN_visibly():
    """The probe must not fail the run over it, and must not silently report 'unsupported' either —
    it records the error and grades the capability unknown."""
    out = _run(probe.probe("AA:BB", None, _fs=lambda: _FakeFs(), _client=lambda: _FakeClient(raises=True)))
    assert out["firmware"] is None
    assert "firmware_error" in out and "not found" in out["firmware_error"]
    assert out["offline_supported"] is None
    assert out["verdict"]["offline_recording_supported"] is None


def test_a_device_that_will_not_report_its_clock_yields_a_null_offset():
    out = _run(probe.probe("AA:BB", None,
                           _fs=lambda: _FakeFs(when=None), _client=lambda: _FakeClient()))
    assert out["device_time"] is None
    assert out["clock_offset_sec"] is None, "an unmeasured offset must never render as 0.0"


def test_main_prints_json_and_exits_zero(capsys, monkeypatch):
    import json as _json
    async def fake_probe(address, adapter=None, **kw):
        return {"address": address, "hci": adapter, "verdict": {"blockers": []}}
    monkeypatch.setattr(probe, "probe", fake_probe)
    assert probe.main(["--address", "AA:BB", "--adapter", "hci1"]) == 0
    out = _json.loads(capsys.readouterr().out)
    assert out["address"] == "AA:BB" and out["hci"] == "hci1"
